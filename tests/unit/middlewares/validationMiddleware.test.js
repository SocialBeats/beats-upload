import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

let validateCreateBeat, validateUpdateBeat, validateQueryParams;

// Mock logger antes de importar el middleware
vi.mock('../../../logger.js', () => ({
  default: {
    warn: vi.fn(),
  },
}));

beforeAll(async () => {
  const module = await import(
    '../../../src/middlewares/validationMiddleware.js'
  );
  validateCreateBeat = module.validateCreateBeat;
  validateUpdateBeat = module.validateUpdateBeat;
  validateQueryParams = module.validateQueryParams;
});

describe('Validation Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {},
      query: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('validateCreateBeat', () => {
    const validBeatData = {
      title: 'Test Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 5000000,
        format: 'mp3',
      },
    };

    it('should pass validation with all required fields', () => {
      req.body = { ...validBeatData };
      validateCreateBeat(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    describe('Title validation', () => {
      it('should fail if title is missing', () => {
        req.body = { ...validBeatData, title: undefined };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            message: 'Validation failed',
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'title',
                message: 'Title is required',
              }),
            ]),
          })
        );
      });

      it('should fail if title is empty string', () => {
        req.body = { ...validBeatData, title: '   ' };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if title exceeds 100 characters', () => {
        req.body = { ...validBeatData, title: 'a'.repeat(101) };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'title',
                message: 'Title cannot exceed 100 characters',
              }),
            ]),
          })
        );
      });
    });

    describe('Genre validation', () => {
      it('should fail if genre is missing', () => {
        req.body = { ...validBeatData, genre: undefined };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'genre',
                message: 'Genre is required',
              }),
            ]),
          })
        );
      });

      it('should fail if genre is invalid', () => {
        req.body = { ...validBeatData, genre: 'InvalidGenre' };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'genre',
                message: expect.stringContaining('Genre must be one of'),
              }),
            ]),
          })
        );
      });

      it('should pass with all valid genres', () => {
        const validGenres = [
          'Hip Hop',
          'Trap',
          'R&B',
          'Pop',
          'Rock',
          'Electronic',
          'Jazz',
          'Reggaeton',
          'Other',
        ];
        validGenres.forEach((genre) => {
          vi.clearAllMocks();
          req.body = { ...validBeatData, genre };
          validateCreateBeat(req, res, next);
          expect(next).toHaveBeenCalled();
        });
      });
    });

    // BPM and Duration validation tests removed as these fields no longer exist

    describe('Audio validation', () => {
      it('should fail if audio object is missing', () => {
        req.body = { ...validBeatData, audio: undefined };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if s3Key is missing', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, s3Key: undefined },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if s3Key is empty', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, s3Key: '   ' },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if filename is missing', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, filename: undefined },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if filename is empty', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, filename: '  ' },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if size is missing', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, size: undefined },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if size is not a number', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, size: '5000000' },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if size is zero or negative', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, size: 0 },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);

        vi.clearAllMocks();
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, size: -100 },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if format is invalid', () => {
        req.body = {
          ...validBeatData,
          audio: { ...validBeatData.audio, format: 'ogg' },
        };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with all valid formats', () => {
        const validFormats = ['mp3', 'wav', 'flac', 'aac'];
        validFormats.forEach((format) => {
          vi.clearAllMocks();
          req.body = {
            ...validBeatData,
            audio: { ...validBeatData.audio, format },
          };
          validateCreateBeat(req, res, next);
          expect(next).toHaveBeenCalled();
        });
      });
    });

    describe('Optional fields validation', () => {
      it('should fail if tags is not an array', () => {
        req.body = { ...validBeatData, tags: 'tag1,tag2' };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if tags exceeds 10 items', () => {
        req.body = { ...validBeatData, tags: Array(11).fill('tag') };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid tags array', () => {
        req.body = { ...validBeatData, tags: ['tag1', 'tag2', 'tag3'] };
        validateCreateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should fail if description exceeds 500 characters', () => {
        req.body = { ...validBeatData, description: 'a'.repeat(501) };
        validateCreateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid description', () => {
        req.body = { ...validBeatData, description: 'Valid description' };
        validateCreateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    it('should collect multiple errors', () => {
      req.body = {
        title: '',
        genre: 'Invalid',
      };
      validateCreateBeat(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'title' }),
            expect.objectContaining({ field: 'genre' }),
            expect.objectContaining({ field: 'audio' }),
          ]),
        })
      );
    });
  });

  describe('validateUpdateBeat', () => {
    it('should pass with empty body (no updates)', () => {
      req.body = {};
      validateUpdateBeat(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    describe('Title validation', () => {
      it('should fail if title is empty string', () => {
        req.body = { title: '   ' };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if title is not a string', () => {
        req.body = { title: 123 };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if title exceeds 100 characters', () => {
        req.body = { title: 'a'.repeat(101) };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid title', () => {
        req.body = { title: 'Updated Title' };
        validateUpdateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    describe('Genre validation', () => {
      it('should fail if genre is invalid', () => {
        req.body = { genre: 'InvalidGenre' };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid genre', () => {
        req.body = { genre: 'Trap' };
        validateUpdateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    // BPM and Duration validation tests removed as these fields no longer exist

    describe('Tags validation', () => {
      it('should fail if tags is not an array', () => {
        req.body = { tags: 'tag1,tag2' };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if tags exceeds 10 items', () => {
        req.body = { tags: Array(11).fill('tag') };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid tags', () => {
        req.body = { tags: ['updated', 'tags'] };
        validateUpdateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    describe('Description validation', () => {
      it('should fail if description exceeds 500 characters', () => {
        req.body = { description: 'a'.repeat(501) };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid description', () => {
        req.body = { description: 'Updated description' };
        validateUpdateBeat(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    describe('Forbidden fields', () => {
      it('should fail if trying to update _id', () => {
        req.body = { _id: '123' };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: '_id',
                message: expect.stringContaining('Cannot update'),
              }),
            ]),
          })
        );
      });

      it('should fail if trying to update createdAt', () => {
        req.body = { createdAt: new Date() };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if trying to update createdBy', () => {
        req.body = { createdBy: { userId: 'hacker' } };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if trying to update stats', () => {
        req.body = { stats: { plays: 9999 } };
        validateUpdateBeat(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });
    });

    it('should collect multiple errors', () => {
      req.body = {
        title: '',
        genre: 'Invalid',
        _id: '123',
      };
      validateUpdateBeat(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'title' }),
            expect.objectContaining({ field: 'genre' }),
            expect.objectContaining({ field: '_id' }),
          ]),
        })
      );
    });
  });

  describe('validateQueryParams', () => {
    it('should pass with no query params', () => {
      req.query = {};
      validateQueryParams(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    describe('Page validation', () => {
      it('should fail if page is not a number', () => {
        req.query = { page: 'abc' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if page is less than 1', () => {
        req.query = { page: '0' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid page', () => {
        req.query = { page: '5' };
        validateQueryParams(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    describe('Limit validation', () => {
      it('should fail if limit is not a number', () => {
        req.query = { limit: 'abc' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if limit is less than 1', () => {
        req.query = { limit: '0' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should fail if limit exceeds 50', () => {
        req.query = { limit: '51' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with valid limit', () => {
        req.query = { limit: '20' };
        validateQueryParams(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    // BPM range validation tests removed as bpm field no longer exists

    describe('SortBy validation', () => {
      it('should fail if sortBy is invalid', () => {
        req.query = { sortBy: 'invalidField' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with all valid sortBy fields', () => {
        const validSortFields = ['createdAt', 'title', 'stats.plays'];
        validSortFields.forEach((sortBy) => {
          vi.clearAllMocks();
          req.query = { sortBy };
          validateQueryParams(req, res, next);
          expect(next).toHaveBeenCalled();
        });
      });
    });

    describe('SortOrder validation', () => {
      it('should fail if sortOrder is invalid', () => {
        req.query = { sortOrder: 'invalid' };
        validateQueryParams(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should pass with asc', () => {
        req.query = { sortOrder: 'asc' };
        validateQueryParams(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should pass with desc', () => {
        req.query = { sortOrder: 'desc' };
        validateQueryParams(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should pass with uppercase', () => {
        req.query = { sortOrder: 'ASC' };
        validateQueryParams(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    it('should pass with all valid query params', () => {
      req.query = {
        page: '2',
        limit: '10',
        minBpm: '100',
        maxBpm: '150',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };
      validateQueryParams(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should collect multiple errors', () => {
      req.query = {
        page: '0',
        limit: '100',
        sortBy: 'invalid',
        sortOrder: 'invalid',
      };
      validateQueryParams(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'page' }),
            expect.objectContaining({ field: 'limit' }),
            expect.objectContaining({ field: 'sortBy' }),
            expect.objectContaining({ field: 'sortOrder' }),
          ]),
        })
      );
    });
  });
});
