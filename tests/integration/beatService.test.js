import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { isKafkaEnabled } from '../../src/services/kafkaConsumer.js';
// Remove static import
// import { BeatService } from '../../src/services/beatService.js';
// import { Beat } from '../../src/models/index.js';

// Mock s3 config module with hoisted mocks
const mocks = vi.hoisted(() => {
  return {
    s3Send: vi.fn(),
    executeS3Command: vi.fn(),
    generatePresignedPostUrl: vi.fn(),
    generatePresignedGetUrl: vi.fn(),
    getLimiterStats: vi.fn(() => ({
      running: 0,
      queued: 0,
      done: 0,
      reservoir: null,
    })),
  };
});

class ServerOverloadError extends Error {
  constructor(message = 'Server is too busy') {
    super(message);
    this.name = 'ServerOverloadError';
    this.statusCode = 503;
    this.retryAfter = 5;
  }
}

// Mock GetObjectCommand and DeleteObjectCommand classes
class MockGetObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

class MockDeleteObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

vi.mock('../../src/config/s3.js', () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET_NAME: 'test-bucket',
  executeS3Command: mocks.executeS3Command,
  generatePresignedPostUrl: mocks.generatePresignedPostUrl,
  generatePresignedGetUrl: mocks.generatePresignedGetUrl,
  ServerOverloadError,
  GetObjectCommand: MockGetObjectCommand,
  DeleteObjectCommand: MockDeleteObjectCommand,
  getLimiterStats: mocks.getLimiterStats,
}));

vi.mock('music-metadata', () => ({
  parseStream: vi.fn().mockResolvedValue({
    format: { codec: 'MPEG 1 Layer 3', duration: 120 },
  }),
}));

vi.mock('../../src/services/kafkaConsumer.js', () => ({
  producer: {
    connect: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
  },
  consumer: {
    connect: vi.fn(),
    subscribe: vi.fn(),
    run: vi.fn(),
  },
  startKafkaConsumer: vi.fn(),
  isKafkaEnabled: vi.fn(),
}));

describe('BeatService Integration Tests (with S3)', () => {
  let mongoServer;
  let BeatService; // Dynamic import
  let Beat; // Dynamic import

  beforeAll(async () => {
    // Set Env Vars
    process.env.CDN_DOMAIN = 'https://cdn.test.com';
    process.env.AWS_BUCKET_NAME = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    vi.resetModules(); // Reset modules to ensure mock is used

    // Clear Mongoose models to avoid OverwriteModelError
    mongoose.models = {};

    const modelsModule = await import('../../src/models/index.js');
    Beat = modelsModule.Beat;

    const module = await import('../../src/services/beatService.js');
    BeatService = module.BeatService;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();

    // Cleanup Env
    delete process.env.CDN_DOMAIN;
    delete process.env.AWS_BUCKET_NAME;
    delete process.env.AWS_REGION;
  });

  beforeEach(async () => {
    await Beat.deleteMany({});
    vi.clearAllMocks();

    // Setup default S3 mock response for executeS3Command (audio validation)
    mocks.executeS3Command.mockResolvedValue({ Body: 'mock-stream' });
  });

  describe('createBeat', () => {
    it('should save s3Key correctly', async () => {
      const beatData = {
        title: 'S3 Test Beat',
        artist: 'Test',
        genre: 'Trap',
        bpm: 140,
        duration: 180,
        audio: {
          s3Key: 'beats/audio.mp3',
          filename: 'audio.mp3',
          size: 5000000,
          format: 'mp3',
        },
      };

      const beat = await BeatService.createBeat(beatData);
      expect(beat.audio.s3Key).toBe('beats/audio.mp3');
      // S3 executeS3Command is called for audio validation
      expect(mocks.executeS3Command).toHaveBeenCalled();
    });
  });

  describe('getBeatById', () => {
    it('should return beat by id', async () => {
      const beat = await Beat.create({
        title: 'CDN Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/test.mp3',
          filename: 'test.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const retrievedBeat = await BeatService.getBeatById(beat._id);
      expect(retrievedBeat.title).toBe('CDN Test');
      expect(retrievedBeat.audio.s3Key).toBe('beats/test.mp3');
    });
  });

  describe('deleteBeatPermanently', () => {
    it('should delete file from S3 and document from DB', async () => {
      const beat = await Beat.create({
        title: 'Delete Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/delete.mp3',
          filename: 'delete.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const result = await BeatService.deleteBeatPermanently(beat._id);

      expect(result).toBe(true);

      // Verify S3 deletion via s3Client.send (deleteBeatPermanently uses direct send)
      expect(mocks.s3Send).toHaveBeenCalled();

      // Verify DB deletion
      const dbBeat = await Beat.findById(beat._id);
      expect(dbBeat).toBeNull();
    });

    it('should delete cover from S3 if it exists', async () => {
      // Clear mocks to ensure clean state
      vi.clearAllMocks();

      const beat = await Beat.create({
        title: 'Delete Cover Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/audio.mp3',
          s3CoverKey: 'covers/image.jpg',
          filename: 'audio.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      await BeatService.deleteBeatPermanently(beat._id);

      // Should call s3Send twice - once for audio, once for cover
      expect(mocks.s3Send).toHaveBeenCalledTimes(2);
    });

    it('should handle S3 error gracefully and still delete from DB', async () => {
      // S3 errors during cleanup are caught and logged, not thrown
      const beat = await Beat.create({
        title: 'Error Handling Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/error.mp3',
          filename: 'error.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      mocks.s3Send.mockRejectedValueOnce(new Error('S3 Error'));

      // Should still succeed because S3 errors are caught
      const result = await BeatService.deleteBeatPermanently(beat._id);
      expect(result).toBe(true);

      // Verify DB deletion happened
      const dbBeat = await Beat.findById(beat._id);
      expect(dbBeat).toBeNull();
    });
  });

  describe('updateBeat', () => {
    it('should delete old S3 file when s3Key changes', async () => {
      vi.clearAllMocks();

      const beat = await Beat.create({
        title: 'Update Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/old.mp3',
          filename: 'old.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const updateData = {
        audio: {
          s3Key: 'beats/new.mp3',
          filename: 'new.mp3',
          size: 2000,
          format: 'mp3',
        },
      };

      const updatedBeat = await BeatService.updateBeat(beat._id, updateData);

      expect(updatedBeat.audio.s3Key).toBe('beats/new.mp3');

      // Verify old file deletion via s3Client.send (updateBeat uses direct send for cleanup)
      expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    });

    it('should NOT delete S3 file when s3Key does NOT change', async () => {
      vi.clearAllMocks();

      const beat = await Beat.create({
        title: 'Update No S3 Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/keep.mp3',
          filename: 'keep.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const updateData = {
        title: 'Updated Title',
      };

      const updatedBeat = await BeatService.updateBeat(beat._id, updateData);

      expect(updatedBeat.title).toBe('Updated Title');
      expect(mocks.s3Send).not.toHaveBeenCalled();
    });

    it('should handle S3 error gracefully and still return updated beat', async () => {
      vi.clearAllMocks();

      const beat = await Beat.create({
        title: 'Update Error Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/old.mp3',
          filename: 'old.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const updateData = {
        audio: {
          s3Key: 'beats/new.mp3',
          filename: 'new.mp3',
          size: 2000,
          format: 'mp3',
        },
      };

      mocks.s3Send.mockRejectedValueOnce(new Error('S3 Error'));

      // updateBeat catches S3 errors gracefully, so it should still return the updated beat
      const result = await BeatService.updateBeat(beat._id, updateData);
      expect(result.audio.s3Key).toBe('beats/new.mp3');
    });
  });
  describe('getAllBeats', () => {
    it('should return paginated beats with filters', async () => {
      await Beat.create([
        {
          title: 'Beat 1',
          artist: 'A',
          genre: 'Hip Hop',
          bpm: 90,
          duration: 100,
          audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
        },
        {
          title: 'Beat 2',
          artist: 'B',
          genre: 'Trap',
          bpm: 140,
          duration: 100,
          audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
        },
        {
          title: 'Beat 3',
          artist: 'A',
          genre: 'Hip Hop',
          bpm: 95,
          duration: 100,
          audio: { s3Key: 'k3', filename: 'f3', size: 1, format: 'mp3' },
        },
      ]);

      const result = await BeatService.getAllBeats({
        genre: 'Hip Hop',
        page: 1,
        limit: 10,
      });

      expect(result.beats).toHaveLength(2);
      expect(result.pagination.totalBeats).toBe(2);
      expect(result.beats[0].genre).toBe('Hip Hop');
      expect(result.beats[1].genre).toBe('Hip Hop');
    });
  });

  describe('searchBeats', () => {
    it('should return beats matching search term', async () => {
      await Beat.create([
        {
          title: 'Searchable Beat',
          artist: 'Artist X',
          genre: 'Hip Hop',
          bpm: 90,
          duration: 100,
          audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
        },
        {
          title: 'Hidden Beat',
          artist: 'Artist Y',
          genre: 'Trap',
          bpm: 140,
          duration: 100,
          audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
        },
      ]);

      const result = await BeatService.searchBeats('Searchable');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Searchable Beat');
    });
  });

  describe('incrementPlays', () => {
    it('should increment play count', async () => {
      const beat = await Beat.create({
        title: 'Play Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
        stats: { plays: 0 },
      });

      const updatedBeat = await BeatService.incrementPlays(beat._id);
      expect(updatedBeat.stats.plays).toBe(1);
    });
  });

  describe('getBeatsStats', () => {
    it('should return correct statistics', async () => {
      await Beat.create([
        {
          title: 'B1',
          artist: 'A',
          genre: 'Hip Hop',
          bpm: 90,
          duration: 100,
          audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
          stats: { plays: 10, downloads: 5 },
        },
        {
          title: 'B2',
          artist: 'B',
          genre: 'Trap',
          bpm: 140,
          duration: 200,
          audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
          stats: { plays: 20, downloads: 10 },
        },
      ]);

      const stats = await BeatService.getBeatsStats();

      expect(stats.general.totalBeats).toBe(2);
      expect(stats.general.totalPlays).toBe(30);
      expect(stats.general.totalDownloads).toBe(15);
      expect(stats.genres).toHaveLength(2);
    });
  });

  describe('Consistency & Compensation', () => {
    it('should delete uploaded S3 file if createBeat fails', async () => {
      vi.clearAllMocks();

      const beatData = {
        title: 'Fail Beat',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/fail.mp3',
          filename: 'fail.mp3',
          size: 1000,
          format: 'mp3',
        },
      };

      // Mock executeS3Command to succeed for S3 validation (GetObjectCommand)
      mocks.executeS3Command.mockResolvedValueOnce({ Body: 'mock-stream' });

      // Mock Beat.prototype.save to fail AFTER validation
      vi.spyOn(Beat.prototype, 'save').mockRejectedValueOnce(
        new Error('DB Error')
      );

      await expect(BeatService.createBeat(beatData)).rejects.toThrow(
        'DB Error'
      );

      // Compensation: should call s3Send to delete the orphaned file
      expect(mocks.s3Send).toHaveBeenCalled();
    });

    it('should delete new S3 file if updateBeat fails', async () => {
      vi.clearAllMocks();

      const beat = await Beat.create({
        title: 'Update Fail Test',
        artist: 'Test',
        genre: 'Pop',
        bpm: 120,
        duration: 120,
        audio: {
          s3Key: 'beats/original.mp3',
          filename: 'original.mp3',
          size: 1000,
          format: 'mp3',
        },
      });

      const updateData = {
        audio: {
          s3Key: 'beats/new-fail.mp3',
          filename: 'new-fail.mp3',
          size: 2000,
          format: 'mp3',
        },
      };

      // Mock Beat.findByIdAndUpdate to fail
      vi.spyOn(Beat, 'findByIdAndUpdate').mockRejectedValueOnce(
        new Error('DB Update Error')
      );

      await expect(
        BeatService.updateBeat(beat._id, updateData)
      ).rejects.toThrow('DB Update Error');

      // Compensation: should call s3Send once to delete the NEW file only
      expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    });
  });
});
