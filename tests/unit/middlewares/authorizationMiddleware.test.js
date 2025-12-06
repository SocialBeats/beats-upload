import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest';

describe('Authorization Middleware', () => {
  let requireAuth, requireOwnership, requireBeatAccess, optionalAuth;
  let BeatMock;

  // Rutas relativas desde este archivo de test
  const MIDDLEWARE_PATH = '../../../src/middlewares/authorizationMiddleware.js';
  const MODEL_PATH = '../../../src/models/Beat.js';
  const LOGGER_PATH = '../../../logger.js';

  beforeAll(async () => {
    // 1. Limpiamos la caché de módulos para asegurar una carga limpia
    vi.resetModules();

    // 2. Definimos los mocks ANTES de importar el middleware
    // Mock del Logger
    vi.doMock(LOGGER_PATH, () => ({
      default: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    // Mock del Modelo Beat
    vi.doMock(MODEL_PATH, () => ({
      default: {
        findById: vi.fn(),
      },
    }));

    // 3. Importamos el middleware DINÁMICAMENTE
    // Esto fuerza a que use los mocks que acabamos de definir
    const middleware = await import(MIDDLEWARE_PATH);
    requireAuth = middleware.requireAuth;
    requireOwnership = middleware.requireOwnership;
    requireBeatAccess = middleware.requireBeatAccess;
    optionalAuth = middleware.optionalAuth;

    // 4. Obtenemos la referencia al mock del modelo para poder manipularlo en los tests
    const beatModule = await import(MODEL_PATH);
    BeatMock = beatModule.default;
  });

  // Limpieza final
  afterAll(() => {
    vi.doUnmock(MODEL_PATH);
    vi.doUnmock(LOGGER_PATH);
  });

  let req, res, next;
  const validId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reseteamos el comportamiento del mock de Beat para cada test
    BeatMock.findById.mockReset();

    req = {
      params: {},
      user: {},
      path: '/test',
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('requireAuth', () => {
    it('should call next if user is authenticated', () => {
      req.user = { id: 'user123' };
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 401 if user is missing', () => {
      req.user = undefined;
      requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Authentication required. Please log in.',
        })
      );
    });

    it('should return 401 if user id is missing', () => {
      req.user = {};
      requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('requireOwnership', () => {
    it('should return 401 if user is not authenticated', async () => {
      req.user = undefined;
      await requireOwnership(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 404 if beat not found', async () => {
      req.user = { id: 'user123' };
      req.params.id = validId;
      BeatMock.findById.mockResolvedValue(null);

      await requireOwnership(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 if user is not owner and not admin', async () => {
      req.user = { id: 'user123', roles: ['user'] };
      req.params.id = validId;
      BeatMock.findById.mockResolvedValue({
        createdBy: { userId: 'otherUser' },
      });

      await requireOwnership(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should call next if user is owner', async () => {
      req.user = { id: 'user123', roles: ['user'] };
      req.params.id = validId;
      const beat = { createdBy: { userId: 'user123' } };
      BeatMock.findById.mockResolvedValue(beat);

      await requireOwnership(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.beat).toEqual(beat);
    });

    it('should call next if user is admin', async () => {
      req.user = { id: 'user123', roles: ['admin'] };
      req.params.id = validId;
      const beat = { createdBy: { userId: 'otherUser' } };
      BeatMock.findById.mockResolvedValue(beat);

      await requireOwnership(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.beat).toEqual(beat);
    });

    it('should return 400 on CastError', async () => {
      req.user = { id: 'user123' };
      req.params.id = 'invalid';
      const error = new Error('CastError');
      error.name = 'CastError';
      BeatMock.findById.mockRejectedValue(error);

      await requireOwnership(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 500 on generic error', async () => {
      req.user = { id: 'user123' };
      req.params.id = validId;
      BeatMock.findById.mockRejectedValue(new Error('DB Error'));

      await requireOwnership(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('requireBeatAccess', () => {
    it('should return 404 if beat not found', async () => {
      req.params.id = validId;
      BeatMock.findById.mockResolvedValue(null);

      await requireBeatAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should call next if beat is public', async () => {
      req.params.id = validId;
      const beat = { isPublic: true };
      BeatMock.findById.mockResolvedValue(beat);

      await requireBeatAccess(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.beat).toEqual(beat);
    });

    it('should return 401 if beat is private and user not authenticated', async () => {
      req.params.id = validId;
      req.user = undefined;
      const beat = { isPublic: false };
      BeatMock.findById.mockResolvedValue(beat);

      await requireBeatAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 if beat is private and user is not owner/admin', async () => {
      req.params.id = validId;
      req.user = { id: 'user123', roles: ['user'] };
      const beat = { isPublic: false, createdBy: { userId: 'otherUser' } };
      BeatMock.findById.mockResolvedValue(beat);

      await requireBeatAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should call next if beat is private and user is owner', async () => {
      req.params.id = validId;
      req.user = { id: 'user123', roles: ['user'] };
      const beat = { isPublic: false, createdBy: { userId: 'user123' } };
      BeatMock.findById.mockResolvedValue(beat);

      await requireBeatAccess(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should call next if beat is private and user is admin', async () => {
      req.params.id = validId;
      req.user = { id: 'user123', roles: ['admin'] };
      const beat = { isPublic: false, createdBy: { userId: 'otherUser' } };
      BeatMock.findById.mockResolvedValue(beat);

      await requireBeatAccess(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 400 on CastError', async () => {
      req.params.id = 'invalid';
      const error = new Error('CastError');
      error.name = 'CastError';
      BeatMock.findById.mockRejectedValue(error);

      await requireBeatAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 on generic error', async () => {
      req.params.id = validId;
      BeatMock.findById.mockRejectedValue(new Error('DB Error'));

      await requireBeatAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('optionalAuth', () => {
    it('should call next if user exists', () => {
      req.user = { id: 'user123' };
      optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should call next if user does not exist', () => {
      req.user = undefined;
      optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
