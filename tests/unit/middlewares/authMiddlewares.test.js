import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      method: 'GET',
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  it('should allow open paths without token', () => {
    req.path = '/api/v1/health';
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should allow public GET paths without token', () => {
    req.path = '/api/v1/beats';
    req.method = 'GET';
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should populate user in public GET paths if headers are present', () => {
    req.path = '/api/v1/beats';
    req.method = 'GET';
    req.headers['x-gateway-authenticated'] = 'true';
    req.headers['x-user-id'] = 'user123';
    req.headers['x-username'] = 'testuser';
    req.headers['x-roles'] = 'admin,user';

    verifyToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'user123',
      username: 'testuser',
      roles: ['admin', 'user'],
    });
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

  it('should return 401 if gateway auth header is missing for protected route', () => {
    req.path = '/api/v1/protected';
    req.method = 'POST';
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Authentication required. Request must come through the API Gateway.',
      })
    );
  });

  it('should return 401 if gateway auth header is false', () => {
    req.path = '/api/v1/protected';
    req.method = 'POST';
    req.headers['x-gateway-authenticated'] = 'false';
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 if user id header is missing', () => {
    req.path = '/api/v1/protected';
    req.method = 'POST';
    req.headers['x-gateway-authenticated'] = 'true';
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Missing user identification',
      })
    );
  });

  it('should call next and set user if headers are valid', () => {
    req.path = '/api/v1/protected';
    req.method = 'POST';
    req.headers['x-gateway-authenticated'] = 'true';
    req.headers['x-user-id'] = 'user123';
    req.headers['x-username'] = 'testuser';
    req.headers['x-roles'] = 'user';

    verifyToken(req, res, next);

    expect(req.user).toEqual({
      id: 'user123',
      username: 'testuser',
      roles: ['user'],
    });
    expect(next).toHaveBeenCalled();
  });
});
