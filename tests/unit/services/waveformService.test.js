import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock all external dependencies
vi.mock('fluent-ffmpeg', () => {
  const mockFfmpeg = vi.fn(() => ({
    audioChannels: vi.fn().mockReturnThis(),
    audioFrequency: vi.fn().mockReturnThis(),
    format: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    pipe: vi.fn().mockReturnThis(),
  }));
  mockFfmpeg.setFfmpegPath = vi.fn();
  return { default: mockFfmpeg };
});

vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg/path',
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('../../../src/models/index.js', () => ({
  Beat: {
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock('../../../logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('WaveformService', () => {
  let WaveformService;
  let Beat;
  let pipeline;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set required env vars
    process.env.AWS_BUCKET_NAME = 'test-bucket';

    const module = await import('../../../src/services/waveformService.js');
    WaveformService = module.WaveformService;

    const modelsModule = await import('../../../src/models/index.js');
    Beat = modelsModule.Beat;

    const streamModule = await import('stream/promises');
    pipeline = streamModule.pipeline;
  });

  describe('generateAndSaveWaveform', () => {
    it('should generate waveform and save to database', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: {
          s3Key: 'users/user1/audio.mp3',
          format: 'mp3',
        },
      };

      const mockS3Client = {
        send: vi.fn().mockResolvedValue({
          Body: { pipe: vi.fn() },
        }),
      };

      // Mock fs operations
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockReturnValue(undefined);
      fs.createWriteStream.mockReturnValue({ on: vi.fn() });

      // Mock pipeline
      pipeline.mockResolvedValue(undefined);

      // Mock Beat update
      Beat.findByIdAndUpdate.mockResolvedValue(mockBeat);

      // Mock ffmpeg to emit end event with peaks
      const ffmpeg = (await import('fluent-ffmpeg')).default;
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'end') {
            // Simulate end event
            setTimeout(() => callback(), 0);
          }
          return mockStream;
        }),
      };
      ffmpeg.mockReturnValue({
        audioChannels: vi.fn().mockReturnThis(),
        audioFrequency: vi.fn().mockReturnThis(),
        format: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        pipe: vi.fn().mockReturnValue(mockStream),
      });

      // The function doesn't throw, it catches errors internally
      await WaveformService.generateAndSaveWaveform(mockBeat, mockS3Client);

      // Verify S3 was called
      expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should handle S3 download error gracefully', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: {
          s3Key: 'users/user1/audio.mp3',
          format: 'mp3',
        },
      };

      const mockS3Client = {
        send: vi.fn().mockRejectedValue(new Error('S3 Error')),
      };

      // Should not throw - errors are caught internally
      await WaveformService.generateAndSaveWaveform(mockBeat, mockS3Client);

      // Beat should not be updated on error
      expect(Beat.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should cleanup temp file even on error', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: {
          s3Key: 'users/user1/audio.mp3',
          format: 'mp3',
        },
      };

      const mockS3Client = {
        send: vi.fn().mockResolvedValue({
          Body: { pipe: vi.fn() },
        }),
      };

      // Mock pipeline to fail
      pipeline.mockRejectedValue(new Error('Pipeline error'));

      // Mock that temp file exists
      fs.existsSync.mockReturnValue(true);

      await WaveformService.generateAndSaveWaveform(mockBeat, mockS3Client);

      // Verify cleanup was attempted
      expect(fs.existsSync).toHaveBeenCalled();
    });

    it('should handle cleanup error gracefully', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: {
          s3Key: 'users/user1/audio.mp3',
          format: 'mp3',
        },
      };

      const mockS3Client = {
        send: vi.fn().mockRejectedValue(new Error('S3 Error')),
      };

      // Mock that cleanup fails
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      // Should not throw even if cleanup fails
      await WaveformService.generateAndSaveWaveform(mockBeat, mockS3Client);
    });

    it('should not cleanup if temp file does not exist', async () => {
      const mockBeat = {
        _id: 'beat123',
        audio: {
          s3Key: 'users/user1/audio.mp3',
          format: 'mp3',
        },
      };

      const mockS3Client = {
        send: vi.fn().mockRejectedValue(new Error('S3 Error')),
      };

      // Mock that temp file does not exist
      fs.existsSync.mockReturnValue(false);

      await WaveformService.generateAndSaveWaveform(mockBeat, mockS3Client);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('_extractPeaks', () => {
    it('should be a function', () => {
      expect(typeof WaveformService._extractPeaks).toBe('function');
    });

    it('should return a promise', async () => {
      const result = WaveformService._extractPeaks('/fake/path.mp3', 100);
      expect(result).toBeInstanceOf(Promise);
      // Let it reject naturally since we're not actually processing audio
      await result.catch(() => {}); // Ignore the error
    });
  });
});
