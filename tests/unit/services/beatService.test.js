import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Beat } from '../../../src/models/index.js';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
  };
});

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
          userId: 'user123',
        })
      ).rejects.toThrow('Invalid MIME type');
    });
  });

  describe('createBeat', () => {
    it('should create a beat successfully', async () => {
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
  });
});
