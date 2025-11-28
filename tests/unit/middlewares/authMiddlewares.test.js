import { describe, it, expect, vi, beforeEach } from 'vitest';
// import verifyToken from '../../../src/middlewares/authMiddlewares.js';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken');

describe('Auth Middleware', () => {
  let req, res, next;
  let verifyToken;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const module = await import('../../../src/middlewares/authMiddlewares.js');
    verifyToken = module.default;

    req = {
      path: '',
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
    process.env.JWT_SECRET = 'test-secret';
  });

  it('should allow open paths without token', () => {
    req.path = '/api/v1/health';
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should allow beats path without token', () => {
    req.path = '/api/v1/beats';
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 400 if version is missing', () => {
    req.path = '/api/beats';
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('specify the API version'),
      })
    );
  });

  it('should return 401 if token is missing for protected route', () => {
    req.path = '/api/v1/protected';
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Missing token',
      })
    );
  });

  it('should return 403 if token is invalid', () => {
    req.path = '/api/v1/protected';
    req.headers.authorization = 'Bearer invalid-token';
    jwt.verify.mockImplementation(() => {
      throw new Error('Invalid token');
    });

    verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid or expired token',
      })
    );
  });

  it('should call next and set user if token is valid', () => {
    req.path = '/api/v1/protected';
    req.headers.authorization = 'Bearer valid-token';
    const mockUser = { id: 'user123' };
    jwt.verify.mockReturnValue(mockUser);

    verifyToken(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
    expect(req.user).toEqual(mockUser);
    expect(next).toHaveBeenCalled();
  });
});
