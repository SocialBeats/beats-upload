import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Beat } from '../../../src/models/index.js';
import {
  producer,
  isKafkaEnabled,
} from '../../../src/services/kafkaConsumer.js';

// Mock the new s3 config module
const mockGeneratePresignedGetUrl = vi.fn();

// Mock GetObjectCommand class
class MockGetObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

vi.mock('../../../src/config/s3.js', () => ({
  s3Client: {},
  BUCKET_NAME: 'test-bucket',
  executeS3Command: vi.fn(),
  generatePresignedPostUrl: vi.fn(),
  generatePresignedGetUrl: mockGeneratePresignedGetUrl,
  GetObjectCommand: MockGetObjectCommand,
  ServerOverloadError: class ServerOverloadError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ServerOverloadError';
      this.statusCode = 503;
      this.retryAfter = 5;
    }
  },
  getLimiterStats: vi.fn(() => ({
    running: 0,
    queued: 0,
    done: 0,
    reservoir: null,
  })),
}));

// Mocks
vi.mock('../../../src/models/index.js', () => {
  const BeatMock = {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    // Add other methods if needed
  };

  const BeatClass = vi.fn((data) => ({
    ...data,
    save: vi.fn(),
  }));

  Object.assign(BeatClass, BeatMock);

  return {
    Beat: BeatClass,
  };
});

vi.mock('../../../src/services/kafkaConsumer.js', () => ({
  producer: { send: vi.fn() },
  isKafkaEnabled: vi.fn(),
}));

vi.mock('../../../src/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

describe('BeatService - Download & Stats', () => {
  let BeatService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../../../src/services/beatService.js');
    BeatService = module.BeatService;
  });

  describe('incrementDownloads', () => {
    it('should increment downloads atomically and return updated beat', async () => {
      const beatId = 'beat123';
      const updatedBeat = {
        _id: beatId,
        stats: { downloads: 5, plays: 10 },
      };

      // Mock findByIdAndUpdate to return the updated beat
      Beat.findByIdAndUpdate.mockResolvedValue(updatedBeat);
      isKafkaEnabled.mockReturnValue(true);
      producer.send.mockResolvedValue(true);

      const result = await BeatService.incrementDownloads(beatId);

      // Verify findByIdAndUpdate called with correct atomic operator
      expect(Beat.findByIdAndUpdate).toHaveBeenCalledWith(
        beatId,
        { $inc: { 'stats.downloads': 1 } },
        { new: true }
      );

      // Verify Kafka event
      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'beats-events',
          messages: expect.arrayContaining([
            expect.objectContaining({
              value: expect.stringContaining('BEAT_DOWNLOADS_INCREMENTED'),
            }),
          ]),
        })
      );

      expect(result).toEqual(updatedBeat);
    });

    it('should return null if beat not found', async () => {
      Beat.findByIdAndUpdate.mockResolvedValue(null);
      const result = await BeatService.incrementDownloads('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getDownloadPresignedUrl', () => {
    it('should generate a presigned URL with attachment disposition', async () => {
      const beatId = 'beat123';
      const mockBeat = {
        _id: beatId,
        audio: {
          s3Key: 'beats/test.mp3',
          filename: 'MyCoolBeat.mp3',
        },
      };

      Beat.findById.mockResolvedValue(mockBeat);
      mockGeneratePresignedGetUrl.mockResolvedValue(
        'https://s3.aws.com/presigned-download-url'
      );

      const url = await BeatService.getDownloadPresignedUrl(beatId);

      expect(Beat.findById).toHaveBeenCalledWith(beatId);

      // Verify generatePresignedGetUrl was called with a GetObjectCommand and options
      expect(mockGeneratePresignedGetUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: expect.any(String),
            Key: mockBeat.audio.s3Key,
            ResponseContentDisposition: `attachment; filename="${mockBeat.audio.filename}"`,
          }),
        }),
        expect.objectContaining({ expiresIn: 300 })
      );

      expect(url).toBe('https://s3.aws.com/presigned-download-url');
    });

    it('should throw error if beat not found', async () => {
      Beat.findById.mockResolvedValue(null);
      await expect(
        BeatService.getDownloadPresignedUrl('fakeId')
      ).rejects.toThrow('Beat or audio file not found');
    });

    it('should throw ServerOverloadError when server is overloaded', async () => {
      const { ServerOverloadError } = await import('../../../src/config/s3.js');
      const beatId = 'beat123';
      const mockBeat = {
        _id: beatId,
        audio: {
          s3Key: 'beats/test.mp3',
          filename: 'MyCoolBeat.mp3',
        },
      };

      Beat.findById.mockResolvedValue(mockBeat);
      mockGeneratePresignedGetUrl.mockRejectedValue(
        new ServerOverloadError('Server too busy')
      );

      await expect(BeatService.getDownloadPresignedUrl(beatId)).rejects.toThrow(
        'Server too busy'
      );
    });
  });
});
