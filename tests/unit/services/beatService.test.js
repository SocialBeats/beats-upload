import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Beat } from '../../../src/models/index.js';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseStream } from 'music-metadata';

vi.mock('../../../src/models/index.js', () => {
  const BeatMock = {
    find: vi.fn(() => ({
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
    })),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    findWithFilters: vi.fn(),
    countDocuments: vi.fn(),
    aggregate: vi.fn(),
  };

  const BeatClass = vi.fn((data) => ({
    ...data,
    save: vi.fn(),
    incrementPlays: vi.fn(),
  }));

  Object.assign(BeatClass, BeatMock);

  return {
    Beat: BeatClass,
  };
});

vi.mock('@aws-sdk/client-s3', () => {
  const sendMock = vi.fn();
  return {
    S3Client: vi.fn(function () {
      return { send: sendMock };
    }),
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
  };
});

vi.mock('music-metadata', () => ({
  parseStream: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

describe('BeatService', () => {
  let BeatService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../../../src/services/beatService.js');
    BeatService = module.BeatService;
  });

  describe('generatePresignedUploadUrl', () => {
    it('should generate a presigned URL for valid input', async () => {
      getSignedUrl.mockResolvedValue('https://presigned-url.com');

      const result = await BeatService.generatePresignedUploadUrl({
        extension: 'mp3',
        mimetype: 'audio/mpeg',
        size: 1024 * 1024, // 1MB
        userId: 'user123',
      });

      expect(result).toHaveProperty('uploadUrl', 'https://presigned-url.com');
      expect(result).toHaveProperty('s3Key');
      expect(result.s3Key).toContain('users/user123/');
      expect(result.s3Key).toContain('.mp3');
      expect(PutObjectCommand).toHaveBeenCalled();
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('should throw error for invalid extension', async () => {
      await expect(
        BeatService.generatePresignedUploadUrl({
          extension: 'exe',
          mimetype: 'application/x-msdownload',
          userId: 'user123',
        })
      ).rejects.toThrow('Invalid file extension');
    });

    it('should throw error for invalid mimetype', async () => {
      await expect(
        BeatService.generatePresignedUploadUrl({
          extension: 'mp3',
          mimetype: 'application/json',
          size: 1024,
          userId: 'user123',
        })
      ).rejects.toThrow('Invalid MIME type');
    });

    it('should throw error if file size exceeds limit', async () => {
      await expect(
        BeatService.generatePresignedUploadUrl({
          extension: 'mp3',
          mimetype: 'audio/mpeg',
          size: 51 * 1024 * 1024, // 51MB
          userId: 'user123',
        })
      ).rejects.toThrow('File size exceeds maximum allowed');
    });
  });

  describe('getAudioPresignedUrl', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, CDN_DOMAIN: 'https://cdn.example.com' };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return CDN URL for valid beat', async () => {
      const mockBeat = { _id: 'beat123', audio: { s3Key: 'audio.mp3' } };
      Beat.findById = vi.fn().mockResolvedValue(mockBeat);

      const result = await BeatService.getAudioPresignedUrl('beat123');

      expect(Beat.findById).toHaveBeenCalledWith('beat123');
      expect(result).toBe('https://cdn.example.com/audio.mp3');
    });

    it('should handle leading slash in s3Key', async () => {
      const mockBeat = { _id: 'beat123', audio: { s3Key: '/audio.mp3' } };
      Beat.findById = vi.fn().mockResolvedValue(mockBeat);

      const result = await BeatService.getAudioPresignedUrl('beat123');

      expect(result).toBe('https://cdn.example.com/audio.mp3');
    });

    it('should throw error if beat not found', async () => {
      Beat.findById = vi.fn().mockResolvedValue(null);
      await expect(BeatService.getAudioPresignedUrl('beat123')).rejects.toThrow(
        'Beat or audio file not found'
      );
    });
  });

  describe('createBeat', () => {
    it('should create a beat successfully without audio file (metadata only)', async () => {
      const beatData = { title: 'New Beat' };
      const savedBeat = { _id: 'beat123', ...beatData };

      // Mock Beat constructor and save method
      const saveMock = vi.fn().mockResolvedValue(savedBeat);
      Beat.mockImplementation(function () {
        return { save: saveMock };
      });

      const result = await BeatService.createBeat(beatData);

      expect(Beat).toHaveBeenCalledWith(beatData);
      expect(saveMock).toHaveBeenCalled();
      expect(result).toEqual(savedBeat);
    });

    it('should validate and create beat with valid audio file', async () => {
      const beatData = {
        title: 'New Beat',
        audio: { s3Key: 'valid.mp3' },
      };
      const savedBeat = { _id: 'beat123', ...beatData };

      // Mock S3 GetObject
      const s3SendMock = new S3Client().send;
      s3SendMock.mockResolvedValueOnce({ Body: 'stream' });

      // Mock music-metadata
      parseStream.mockResolvedValueOnce({
        format: { codec: 'MPEG 1 Layer 3', duration: 120 },
      });

      const saveMock = vi.fn().mockResolvedValue(savedBeat);
      Beat.mockImplementation(function () {
        return { save: saveMock };
      });

      const result = await BeatService.createBeat(beatData);

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: 'valid.mp3',
      });
      expect(parseStream).toHaveBeenCalledWith('stream');
      expect(saveMock).toHaveBeenCalled();
      expect(result).toEqual(savedBeat);
    });

    it('should throw error and delete file if audio validation fails', async () => {
      const beatData = {
        title: 'Fake Beat',
        audio: { s3Key: 'fake.mp3' },
      };

      // Mock S3 GetObject
      const s3SendMock = new S3Client().send;
      s3SendMock.mockResolvedValueOnce({ Body: 'stream' });

      // Mock music-metadata to return invalid format (no codec)
      parseStream.mockResolvedValueOnce({
        format: {},
      });

      await expect(BeatService.createBeat(beatData)).rejects.toThrow(
        'Audio validation failed'
      );

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: 'fake.mp3',
      });
    });
  });

  describe('getAllBeats', () => {
    it('should return paginated beats', async () => {
      const mockBeats = [{ title: 'Beat 1' }, { title: 'Beat 2' }];
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue(mockBeats),
        getQuery: vi.fn().mockReturnValue({}),
      };

      Beat.findWithFilters = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(20);

      const result = await BeatService.getAllBeats({ page: 1, limit: 10 });

      expect(Beat.findWithFilters).toHaveBeenCalled();
      expect(result.beats).toEqual(mockBeats);
      expect(result.pagination.totalBeats).toBe(20);
      expect(result.pagination.totalPages).toBe(2);
    });
  });

  describe('getBeatById', () => {
    it('should return beat if found', async () => {
      const mockBeat = { _id: 'beat123', title: 'Beat 1' };
      Beat.findById = vi.fn().mockResolvedValue(mockBeat);

      const result = await BeatService.getBeatById('beat123');

      expect(Beat.findById).toHaveBeenCalledWith('beat123');
      expect(result).toEqual(mockBeat);
    });

    it('should return null if not found', async () => {
      Beat.findById = vi.fn().mockResolvedValue(null);

      const result = await BeatService.getBeatById('beat123');

      expect(result).toBeNull();
    });
  });

  describe('updateBeat', () => {
    it('should update beat and delete old file if s3Key changes', async () => {
      const oldBeat = { _id: 'beat123', audio: { s3Key: 'old.mp3' } };
      const updatedBeat = { _id: 'beat123', audio: { s3Key: 'new.mp3' } };

      Beat.findById = vi.fn().mockResolvedValue(oldBeat);
      Beat.findByIdAndUpdate = vi.fn().mockResolvedValue(updatedBeat);

      const result = await BeatService.updateBeat('beat123', {
        audio: { s3Key: 'new.mp3' },
      });

      expect(Beat.findById).toHaveBeenCalledWith('beat123');
      expect(Beat.findByIdAndUpdate).toHaveBeenCalled();
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: 'old.mp3',
      });
      const s3Instance = new S3Client();
      expect(s3Instance.send).toHaveBeenCalled();
      expect(result).toEqual(updatedBeat);
    });

    it('should update beat without deleting file if s3Key is same', async () => {
      const oldBeat = { _id: 'beat123', audio: { s3Key: 'same.mp3' } };
      const updatedBeat = { _id: 'beat123', audio: { s3Key: 'same.mp3' } };

      Beat.findById = vi.fn().mockResolvedValue(oldBeat);
      Beat.findByIdAndUpdate = vi.fn().mockResolvedValue(updatedBeat);

      await BeatService.updateBeat('beat123', { audio: { s3Key: 'same.mp3' } });

      expect(DeleteObjectCommand).not.toHaveBeenCalled();
    });
  });

  describe('deleteBeatPermanently', () => {
    it('should delete beat and associated files', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: { s3Key: 'audio.mp3', s3CoverKey: 'cover.jpg' },
      };

      Beat.findById = vi.fn().mockResolvedValue(mockBeat);
      Beat.findByIdAndDelete = vi.fn().mockResolvedValue(mockBeat);

      const result = await BeatService.deleteBeatPermanently('beat123');

      expect(Beat.findById).toHaveBeenCalledWith('beat123');
      expect(Beat.findByIdAndDelete).toHaveBeenCalledWith('beat123');
      // Should delete audio and cover
      expect(DeleteObjectCommand).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });

    it('should return false if beat not found', async () => {
      Beat.findById = vi.fn().mockResolvedValue(null);

      const result = await BeatService.deleteBeatPermanently('beat123');

      expect(result).toBe(false);
      expect(Beat.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('should handle S3 deletion errors gracefully for audio', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: { s3Key: 'audio.mp3' },
      };

      Beat.findById = vi.fn().mockResolvedValue(mockBeat);
      Beat.findByIdAndDelete = vi.fn().mockResolvedValue(mockBeat);

      const s3Instance = new S3Client();
      s3Instance.send.mockRejectedValueOnce(new Error('S3 Error'));

      const result = await BeatService.deleteBeatPermanently('beat123');

      expect(result).toBe(true); // Still returns true even if S3 fails
    });

    it('should handle S3 deletion errors gracefully for cover', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: { s3Key: 'audio.mp3', s3CoverKey: 'cover.jpg' },
      };

      Beat.findById = vi.fn().mockResolvedValue(mockBeat);
      Beat.findByIdAndDelete = vi.fn().mockResolvedValue(mockBeat);

      const s3Instance = new S3Client();
      s3Instance.send
        .mockResolvedValueOnce({}) // Audio deletion succeeds
        .mockRejectedValueOnce(new Error('S3 Cover Error')); // Cover deletion fails

      const result = await BeatService.deleteBeatPermanently('beat123');

      expect(result).toBe(true);
    });

    it('should return false if findByIdAndDelete returns null', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: { s3Key: 'audio.mp3' },
      };

      Beat.findById = vi.fn().mockResolvedValue(mockBeat);
      Beat.findByIdAndDelete = vi.fn().mockResolvedValue(null);

      const result = await BeatService.deleteBeatPermanently('beat123');

      expect(result).toBe(false);
    });
  });

  describe('incrementPlays', () => {
    it('should increment plays for a beat', async () => {
      const mockBeat = {
        _id: 'beat123',
        incrementPlays: vi.fn().mockResolvedValue({ stats: { plays: 1 } }),
      };

      Beat.findById = vi.fn().mockResolvedValue(mockBeat);

      const result = await BeatService.incrementPlays('beat123');

      expect(Beat.findById).toHaveBeenCalledWith('beat123');
      expect(mockBeat.incrementPlays).toHaveBeenCalled();
      expect(result.stats.plays).toBe(1);
    });

    it('should return null if beat not found', async () => {
      Beat.findById = vi.fn().mockResolvedValue(null);

      const result = await BeatService.incrementPlays('beat123');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      Beat.findById = vi.fn().mockRejectedValue(new Error('DB Error'));

      await expect(BeatService.incrementPlays('beat123')).rejects.toThrow(
        'DB Error'
      );
    });
  });

  describe('searchBeats', () => {
    it('should search beats by term', async () => {
      const mockBeats = [{ title: 'Hip Hop Beat' }];
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue(mockBeats),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);

      const result = await BeatService.searchBeats('Hip Hop', {
        page: 1,
        limit: 10,
      });

      expect(Beat.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ title: expect.anything() }),
          ]),
          isPublic: true,
        })
      );
      expect(result).toEqual(mockBeats);
    });

    it('should handle search errors', async () => {
      Beat.find = vi.fn().mockImplementation(() => {
        throw new Error('Search Error');
      });

      await expect(
        BeatService.searchBeats('test', { page: 1, limit: 10 })
      ).rejects.toThrow('Search Error');
    });
  });

  describe('getUserBeats', () => {
    it('should return user beats with pagination', async () => {
      const mockBeats = [
        {
          _id: 'beat1',
          title: 'User Beat 1',
          createdBy: { userId: 'user123' },
        },
        {
          _id: 'beat2',
          title: 'User Beat 2',
          createdBy: { userId: 'user123' },
        },
      ];
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue(mockBeats),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(10);

      const result = await BeatService.getUserBeats('user123', {
        page: 1,
        limit: 10,
      });

      expect(Beat.find).toHaveBeenCalledWith({
        'createdBy.userId': 'user123',
      });
      expect(result.beats).toEqual(mockBeats);
      expect(result.pagination.totalBeats).toBe(10);
      expect(result.userId).toBe('user123');
    });

    it('should include private beats by default', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(0);

      await BeatService.getUserBeats('user123');

      expect(Beat.find).toHaveBeenCalledWith({
        'createdBy.userId': 'user123',
      });
    });

    it('should exclude private beats when includePrivate is false', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(0);

      await BeatService.getUserBeats('user123', { includePrivate: false });

      expect(Beat.find).toHaveBeenCalledWith({
        'createdBy.userId': 'user123',
        isPublic: true,
      });
    });

    it('should apply genre filter correctly', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(0);

      await BeatService.getUserBeats('user123', { genre: 'Hip Hop' });

      expect(Beat.find).toHaveBeenCalledWith({
        'createdBy.userId': 'user123',
        genre: 'Hip Hop',
      });
    });

    // BPM filters test removed as bpm field no longer exists

    it('should apply tags filter correctly', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(0);

      await BeatService.getUserBeats('user123', {
        tags: ['chill', 'summer'],
      });

      expect(Beat.find).toHaveBeenCalledWith({
        'createdBy.userId': 'user123',
        tags: { $in: ['chill', 'summer'] },
      });
    });

    it('should handle custom sort options', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(0);

      await BeatService.getUserBeats('user123', {
        sortBy: 'title',
        sortOrder: 'asc',
      });

      expect(mockQuery.sort).toHaveBeenCalledWith({ title: 1 });
    });

    it('should handle pagination correctly', async () => {
      const mockQuery = {
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };

      Beat.find = vi.fn().mockReturnValue(mockQuery);
      Beat.countDocuments = vi.fn().mockResolvedValue(25);

      const result = await BeatService.getUserBeats('user123', {
        page: 2,
        limit: 10,
      });

      expect(mockQuery.skip).toHaveBeenCalledWith(10);
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it('should handle getUserBeats errors', async () => {
      Beat.find = vi.fn().mockImplementation(() => {
        throw new Error('Database Error');
      });

      await expect(
        BeatService.getUserBeats('user123', { page: 1, limit: 10 })
      ).rejects.toThrow('Database Error');
    });
  });

  describe('getBeatsStats', () => {
    it('should return beats statistics', async () => {
      const mockStats = [
        {
          _id: null,
          totalBeats: 100,
          totalPlays: 5000,
          totalDownloads: 500,
        },
      ];
      const mockGenreStats = [
        { _id: 'Hip Hop', count: 40 },
        { _id: 'Trap', count: 35 },
      ];

      Beat.aggregate = vi
        .fn()
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockGenreStats);

      const result = await BeatService.getBeatsStats();

      expect(Beat.aggregate).toHaveBeenCalledTimes(2);
      expect(result.general).toEqual(mockStats[0]);
      expect(result.genres).toEqual(mockGenreStats);
    });

    it('should return empty general stats if no beats exist', async () => {
      Beat.aggregate = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await BeatService.getBeatsStats();

      expect(result.general).toEqual({});
      expect(result.genres).toEqual([]);
    });

    it('should handle stats errors', async () => {
      Beat.aggregate = vi.fn().mockRejectedValue(new Error('Stats Error'));

      await expect(BeatService.getBeatsStats()).rejects.toThrow('Stats Error');
    });
  });

  describe('Error Handling', () => {
    it('should handle createBeat errors', async () => {
      const saveMock = vi.fn().mockRejectedValue(new Error('Save Error'));
      Beat.mockImplementation(function () {
        return { save: saveMock };
      });

      await expect(BeatService.createBeat({ title: 'Test' })).rejects.toThrow(
        'Save Error'
      );
    });

    it('should handle getAllBeats errors', async () => {
      Beat.findWithFilters = vi.fn().mockImplementation(() => {
        throw new Error('Query Error');
      });

      await expect(BeatService.getAllBeats()).rejects.toThrow('Query Error');
    });

    it('should handle getBeatById errors', async () => {
      Beat.findById = vi.fn().mockRejectedValue(new Error('Find Error'));

      await expect(BeatService.getBeatById('beat123')).rejects.toThrow(
        'Find Error'
      );
    });

    it('should handle updateBeat errors', async () => {
      Beat.findById = vi.fn().mockRejectedValue(new Error('Update Error'));

      await expect(
        BeatService.updateBeat('beat123', { title: 'New Title' })
      ).rejects.toThrow('Update Error');
    });

    it('should handle deleteBeatPermanently errors', async () => {
      Beat.findById = vi.fn().mockRejectedValue(new Error('Delete Error'));

      await expect(
        BeatService.deleteBeatPermanently('beat123')
      ).rejects.toThrow('Delete Error');
    });

    it('should handle S3 errors during update gracefully', async () => {
      const oldBeat = { _id: 'beat123', audio: { s3Key: 'old.mp3' } };
      const updatedBeat = { _id: 'beat123', audio: { s3Key: 'new.mp3' } };

      Beat.findById = vi.fn().mockResolvedValue(oldBeat);
      Beat.findByIdAndUpdate = vi.fn().mockResolvedValue(updatedBeat);

      const s3Instance = new S3Client();
      s3Instance.send.mockRejectedValueOnce(new Error('S3 Delete Failed'));

      const result = await BeatService.updateBeat('beat123', {
        audio: { s3Key: 'new.mp3' },
      });

      // Should still return updated beat even if S3 deletion fails
      expect(result).toEqual(updatedBeat);
    });
  });

  describe('Edge Cases', () => {
    it('should handle anonymous user in generatePresignedUploadUrl', async () => {
      getSignedUrl.mockResolvedValue('https://presigned-url.com');

      const result = await BeatService.generatePresignedUploadUrl({
        extension: 'mp3',
        mimetype: 'audio/mpeg',
        userId: null,
      });

      expect(result.s3Key).toContain('users/anonymous/');
    });

    it('should handle case-insensitive extension validation', async () => {
      getSignedUrl.mockResolvedValue('https://presigned-url.com');

      const result = await BeatService.generatePresignedUploadUrl({
        extension: 'MP3',
        mimetype: 'audio/mpeg',
        userId: 'user123',
      });

      expect(result.s3Key).toContain('.MP3');
    });

    it('should handle case-insensitive mimetype validation', async () => {
      getSignedUrl.mockResolvedValue('https://presigned-url.com');

      const result = await BeatService.generatePresignedUploadUrl({
        extension: 'wav',
        mimetype: 'AUDIO/WAV',
        userId: 'user123',
      });

      expect(result).toHaveProperty('uploadUrl');
    });

    it('should accept alternative audio mimetypes', async () => {
      getSignedUrl.mockResolvedValue('https://presigned-url.com');

      // Test audio/x-wav
      await expect(
        BeatService.generatePresignedUploadUrl({
          extension: 'wav',
          mimetype: 'audio/x-wav',
          userId: 'user123',
        })
      ).resolves.toHaveProperty('uploadUrl');

      // Test audio/x-m4a
      await expect(
        BeatService.generatePresignedUploadUrl({
          extension: 'aac',
          mimetype: 'audio/x-m4a',
          userId: 'user123',
        })
      ).resolves.toHaveProperty('uploadUrl');
    });

    it('should return null from updateBeat when beat not found', async () => {
      Beat.findById = vi.fn().mockResolvedValue(null);

      const result = await BeatService.updateBeat('beat123', {
        title: 'New Title',
      });

      expect(result).toBeNull();
      expect(Beat.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });
});
