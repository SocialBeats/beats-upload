import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { BeatController } from '../../../src/controllers/beatController.js';
// import { BeatService } from '../../../src/services/beatService.js';

vi.mock('../../../src/models/index.js', () => ({
  Beat: {},
}));

vi.mock('../../../src/services/beatService.js', () => ({
  BeatService: {
    generatePresignedUploadUrl: vi.fn(),
    createBeat: vi.fn(),
    getAllBeats: vi.fn(),
    getBeatById: vi.fn(),
    updateBeat: vi.fn(),
    deleteBeatPermanently: vi.fn(),
    searchBeats: vi.fn(),
    incrementPlays: vi.fn(),
    getBeatsStats: vi.fn(),
  },
}));

describe('BeatController', () => {
  let req, res;
  let BeatController;
  let BeatService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const serviceModule = await import('../../../src/services/beatService.js');
    BeatService = serviceModule.BeatService;

    const controllerModule = await import(
      '../../../src/controllers/beatController.js'
    );
    BeatController = controllerModule.BeatController;

    req = {
      body: {},
      params: {},
      query: {},
      user: { id: 'user123' },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('getUploadUrl', () => {
    it('should return upload URL for valid input', async () => {
      req.body = { extension: 'mp3', mimetype: 'audio/mpeg' };
      const mockResult = { uploadUrl: 'url', s3Key: 'key' };
      BeatService.generatePresignedUploadUrl.mockResolvedValue(mockResult);

      await BeatController.getUploadUrl(req, res);

      expect(BeatService.generatePresignedUploadUrl).toHaveBeenCalledWith({
        extension: 'mp3',
        mimetype: 'audio/mpeg',
        userId: 'user123',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockResult,
        })
      );
    });

    it('should handle anonymous user (no req.user)', async () => {
      req.user = undefined;
      req.body = { extension: 'mp3', mimetype: 'audio/mpeg' };
      const mockResult = { uploadUrl: 'url', s3Key: 'key' };
      BeatService.generatePresignedUploadUrl.mockResolvedValue(mockResult);

      await BeatController.getUploadUrl(req, res);

      expect(BeatService.generatePresignedUploadUrl).toHaveBeenCalledWith({
        extension: 'mp3',
        mimetype: 'audio/mpeg',
        userId: 'anonymous',
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if extension missing', async () => {
      req.body = { mimetype: 'audio/mpeg' };
      await BeatController.getUploadUrl(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if size too large', async () => {
      req.body = {
        extension: 'mp3',
        mimetype: 'audio/mpeg',
        size: 100 * 1024 * 1024,
      };
      await BeatController.getUploadUrl(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if service throws Invalid error', async () => {
      req.body = { extension: 'exe', mimetype: 'application/x-msdownload' };
      BeatService.generatePresignedUploadUrl.mockRejectedValue(
        new Error('Invalid file extension')
      );

      await BeatController.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Invalid file extension',
        })
      );
    });

    it('should return 500 on generic error', async () => {
      req.body = { extension: 'mp3', mimetype: 'audio/mpeg' };
      BeatService.generatePresignedUploadUrl.mockRejectedValue(
        new Error('S3 Error')
      );

      await BeatController.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production (no error message)', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.body = { extension: 'mp3', mimetype: 'audio/mpeg' };
      BeatService.generatePresignedUploadUrl.mockRejectedValue(
        new Error('S3 Error')
      );

      await BeatController.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('createBeat', () => {
    it('should create beat successfully', async () => {
      req.body = { title: 'New Beat' };
      const mockBeat = { _id: 'beat1', title: 'New Beat' };
      BeatService.createBeat.mockResolvedValue(mockBeat);

      await BeatController.createBeat(req, res);

      expect(BeatService.createBeat).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Beat',
          createdBy: {
            userId: 'user123',
            username: 'user123',
            roles: [],
          },
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockBeat,
        })
      );
    });

    it('should create beat with username from req.user when available', async () => {
      req.user = { id: 'user123', username: 'testuser', roles: ['artist'] };
      req.body = { title: 'New Beat' };
      const mockBeat = { _id: 'beat1', title: 'New Beat' };
      BeatService.createBeat.mockResolvedValue(mockBeat);

      await BeatController.createBeat(req, res);

      expect(BeatService.createBeat).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: {
            userId: 'user123',
            username: 'testuser',
            roles: ['artist'],
          },
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should handle validation errors', async () => {
      const error = new Error('Validation error');
      error.name = 'ValidationError';
      error.errors = { field: { path: 'field', message: 'error' } };
      BeatService.createBeat.mockRejectedValue(error);

      await BeatController.createBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Validation error',
        })
      );
    });

    it('should return 409 if beat already exists', async () => {
      const error = new Error('Duplicate key');
      error.code = 11000;
      BeatService.createBeat.mockRejectedValue(error);

      await BeatController.createBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Beat with this information already exists',
        })
      );
    });

    it('should return 500 on generic error', async () => {
      BeatService.createBeat.mockRejectedValue(new Error('DB Error'));

      await BeatController.createBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      BeatService.createBeat.mockRejectedValue(new Error('DB Error'));

      await BeatController.createBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getAllBeats', () => {
    it('should return beats with pagination', async () => {
      req.query = { page: '1', limit: '10' };
      const mockResult = { beats: [], pagination: {} };
      BeatService.getAllBeats.mockResolvedValue(mockResult);

      await BeatController.getAllBeats(req, res);

      expect(BeatService.getAllBeats).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 10,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 500 on generic error', async () => {
      BeatService.getAllBeats.mockRejectedValue(new Error('DB Error'));

      await BeatController.getAllBeats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      BeatService.getAllBeats.mockRejectedValue(new Error('DB Error'));

      await BeatController.getAllBeats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getBeatById', () => {
    it('should return beat if found', async () => {
      req.params.id = 'beat1';
      const mockBeat = { _id: 'beat1' };
      BeatService.getBeatById.mockResolvedValue(mockBeat);

      await BeatController.getBeatById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: mockBeat,
        })
      );
    });

    it('should return 404 if not found', async () => {
      req.params.id = 'beat1';
      BeatService.getBeatById.mockResolvedValue(null);

      await BeatController.getBeatById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 on CastError', async () => {
      req.params.id = 'invalid-id';
      const error = new Error('CastError');
      error.name = 'CastError';
      BeatService.getBeatById.mockRejectedValue(error);

      await BeatController.getBeatById(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid beat ID format',
        })
      );
    });

    it('should return 500 on generic error', async () => {
      req.params.id = 'beat1';
      BeatService.getBeatById.mockRejectedValue(new Error('DB Error'));

      await BeatController.getBeatById(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.params.id = 'beat1';
      BeatService.getBeatById.mockRejectedValue(new Error('DB Error'));

      await BeatController.getBeatById(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('updateBeat', () => {
    it('should update beat successfully', async () => {
      req.params.id = 'beat1';
      req.body = { title: 'Updated' };
      const mockBeat = { _id: 'beat1', title: 'Updated' };
      BeatService.updateBeat.mockResolvedValue(mockBeat);

      await BeatController.updateBeat(req, res);

      expect(BeatService.updateBeat).toHaveBeenCalledWith(
        'beat1',
        expect.objectContaining({
          title: 'Updated',
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 if beat not found', async () => {
      req.params.id = 'beat1';
      BeatService.updateBeat.mockResolvedValue(null);

      await BeatController.updateBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 on ValidationError', async () => {
      req.params.id = 'beat1';
      const error = new Error('Validation error');
      error.name = 'ValidationError';
      error.errors = { field: { path: 'field', message: 'error' } };
      BeatService.updateBeat.mockRejectedValue(error);

      await BeatController.updateBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Validation error',
        })
      );
    });

    it('should return 400 on CastError', async () => {
      req.params.id = 'invalid-id';
      const error = new Error('CastError');
      error.name = 'CastError';
      BeatService.updateBeat.mockRejectedValue(error);

      await BeatController.updateBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid beat ID format',
        })
      );
    });

    it('should return 500 on generic error', async () => {
      req.params.id = 'beat1';
      BeatService.updateBeat.mockRejectedValue(new Error('DB Error'));

      await BeatController.updateBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.params.id = 'beat1';
      BeatService.updateBeat.mockRejectedValue(new Error('DB Error'));

      await BeatController.updateBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('deleteBeat', () => {
    it('should delete beat successfully', async () => {
      req.params.id = 'beat1';
      BeatService.deleteBeatPermanently.mockResolvedValue(true);

      await BeatController.deleteBeat(req, res);

      expect(BeatService.deleteBeatPermanently).toHaveBeenCalledWith('beat1');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 if beat not found', async () => {
      req.params.id = 'beat1';
      BeatService.deleteBeatPermanently.mockResolvedValue(false);

      await BeatController.deleteBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 on CastError', async () => {
      req.params.id = 'invalid-id';
      const error = new Error('CastError');
      error.name = 'CastError';
      BeatService.deleteBeatPermanently.mockRejectedValue(error);

      await BeatController.deleteBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid beat ID format',
        })
      );
    });

    it('should return 500 on generic error', async () => {
      req.params.id = 'beat1';
      BeatService.deleteBeatPermanently.mockRejectedValue(
        new Error('DB Error')
      );

      await BeatController.deleteBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.params.id = 'beat1';
      BeatService.deleteBeatPermanently.mockRejectedValue(
        new Error('DB Error')
      );

      await BeatController.deleteBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('searchBeats', () => {
    it('should return search results', async () => {
      req.query = { q: 'test' };
      const mockResults = [{ title: 'test' }];
      BeatService.searchBeats.mockResolvedValue(mockResults);

      await BeatController.searchBeats(req, res);

      expect(BeatService.searchBeats).toHaveBeenCalledWith(
        'test',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: mockResults,
        })
      );
    });

    it('should return 400 if search term is too short', async () => {
      req.query = { q: 'a' };
      await BeatController.searchBeats(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 on generic error', async () => {
      req.query = { q: 'test' };
      BeatService.searchBeats.mockRejectedValue(new Error('DB Error'));

      await BeatController.searchBeats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.query = { q: 'test' };
      BeatService.searchBeats.mockRejectedValue(new Error('DB Error'));

      await BeatController.searchBeats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('playBeat', () => {
    it('should increment plays', async () => {
      req.params.id = 'beat1';
      const mockBeat = { stats: { plays: 1 } };
      BeatService.incrementPlays.mockResolvedValue(mockBeat);

      await BeatController.playBeat(req, res);

      expect(BeatService.incrementPlays).toHaveBeenCalledWith('beat1');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 if beat not found', async () => {
      req.params.id = 'beat1';
      BeatService.incrementPlays.mockResolvedValue(null);

      await BeatController.playBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 500 on generic error', async () => {
      req.params.id = 'beat1';
      BeatService.incrementPlays.mockRejectedValue(new Error('DB Error'));

      await BeatController.playBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      req.params.id = 'beat1';
      BeatService.incrementPlays.mockRejectedValue(new Error('DB Error'));

      await BeatController.playBeat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getStats', () => {
    it('should return stats', async () => {
      const mockStats = { general: {}, genres: [] };
      BeatService.getBeatsStats.mockResolvedValue(mockStats);

      await BeatController.getStats(req, res);

      expect(BeatService.getBeatsStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: mockStats,
        })
      );
    });

    it('should return 500 on generic error', async () => {
      BeatService.getBeatsStats.mockRejectedValue(new Error('DB Error'));

      await BeatController.getStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 on generic error in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      BeatService.getBeatsStats.mockRejectedValue(new Error('DB Error'));

      await BeatController.getStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: undefined,
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });
});
