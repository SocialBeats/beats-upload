import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Beat } from '../../../src/models/index.js';
import {
  producer,
  isKafkaEnabled,
} from '../../../src/services/kafkaConsumer.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner');
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
          topic: 'beats-interaction-group',
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
      getSignedUrl.mockResolvedValue(
        'https://s3.aws.com/presigned-download-url'
      );

      const url = await BeatService.getDownloadPresignedUrl(beatId);

      expect(Beat.findById).toHaveBeenCalledWith(beatId);

      // Verify GetObjectCommand was instantiated with ResponseContentDisposition
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: expect.any(String),
          Key: mockBeat.audio.s3Key,
          ResponseContentDisposition: `attachment; filename="${mockBeat.audio.filename}"`,
        })
      );

      expect(url).toBe('https://s3.aws.com/presigned-download-url');
    });

    it('should throw error if beat not found', async () => {
      Beat.findById.mockResolvedValue(null);
      await expect(
        BeatService.getDownloadPresignedUrl('fakeId')
      ).rejects.toThrow('Beat or audio file not found');
    });
  });
});
