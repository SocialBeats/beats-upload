import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Beat from '../../../src/models/Beat.js';

describe('Beat Model Test', () => {
  let mongoServer;

  beforeAll(async () => {
    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Beat.deleteMany({});
  });

  it('should create & save beat successfully', async () => {
    const validBeat = new Beat({
      title: 'Test Beat',
      artist: 'Test Artist',
      genre: 'Hip Hop',

      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    const savedBeat = await validBeat.save();
    expect(savedBeat._id).toBeDefined();
    expect(savedBeat.title).toBe('Test Beat');
    expect(savedBeat.audio.s3Key).toBe('beats/test.mp3');
  });

  it('should fail validation without required fields', async () => {
    const beatWithoutRequiredField = new Beat({ title: 'Test Beat' });
    let err;
    try {
      await beatWithoutRequiredField.save();
    } catch (error) {
      err = error;
    }
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(err.errors.genre).toBeDefined();
    expect(err.errors['audio.s3Key']).toBeDefined();
  });

  it('should fail validation with invalid genre', async () => {
    const beatWithInvalidGenre = new Beat({
      title: 'Test Beat',
      artist: 'Test Artist',
      genre: 'InvalidGenre',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    let err;
    try {
      await beatWithInvalidGenre.save();
    } catch (error) {
      err = error;
    }
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(err.errors.genre).toBeDefined();
  });

  // formattedDuration virtual removed as duration field no longer exists

  it('should find beats with filters', async () => {
    const beat1 = new Beat({
      title: 'Beat 1',
      artist: 'Artist 1',
      genre: 'Hip Hop',
      bpm: 90,
      duration: 180,
      tags: ['dark', 'hard'],
      audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
      isPublic: true,
    });
    const beat2 = new Beat({
      title: 'Beat 2',
      artist: 'Artist 2',
      genre: 'Trap',
      bpm: 140,
      duration: 180,
      tags: ['melodic'],
      audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
      isPublic: true,
    });
    await beat1.save();
    await beat2.save();

    const hipHopBeats = await Beat.findWithFilters({ genre: 'Hip Hop' });
    expect(hipHopBeats).toHaveLength(1);
    expect(hipHopBeats[0].title).toBe('Beat 1');

    const trapBeats = await Beat.findWithFilters({ genre: 'Trap' });
    expect(trapBeats).toHaveLength(1);
    expect(trapBeats[0].title).toBe('Beat 2');
  });

  it('should increment plays', async () => {
    const beat = new Beat({
      title: 'Test Beat',
      artist: 'Test Artist',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    await beat.save();
    await beat.incrementPlays();
    const updatedBeat = await Beat.findById(beat._id);
    expect(updatedBeat.stats.plays).toBe(1);
  });

  it('should remove __v field when converting to JSON', async () => {
    const beat = new Beat({
      title: 'Test Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    const savedBeat = await beat.save();
    const json = savedBeat.toJSON();
    expect(json.__v).toBeUndefined();
    expect(json.title).toBe('Test Beat');
  });

  it('should remove duplicate tags on save', async () => {
    const beat = new Beat({
      title: 'Test Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      tags: ['trap', 'dark', 'trap', 'dark', 'melodic'],
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    const savedBeat = await beat.save();
    expect(savedBeat.tags).toHaveLength(3);
    expect(savedBeat.tags).toContain('trap');
    expect(savedBeat.tags).toContain('dark');
    expect(savedBeat.tags).toContain('melodic');
  });

  // minBpm filter test removed as bpm field no longer exists

  // maxBpm filter test removed as bpm field no longer exists

  it('should find beats with tags filter', async () => {
    await Beat.deleteMany({});

    const beat1 = new Beat({
      title: 'Dark Beat',
      genre: 'Trap',
      bpm: 140,
      duration: 180,
      tags: ['dark', 'aggressive'],
      audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
      isPublic: true,
    });
    const beat2 = new Beat({
      title: 'Chill Beat',
      genre: 'R&B',
      bpm: 90,
      duration: 180,
      tags: ['chill', 'relaxing'],
      audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
      isPublic: true,
    });
    await beat1.save();
    await beat2.save();

    const darkBeats = await Beat.findWithFilters({ tags: ['dark'] });
    expect(darkBeats).toHaveLength(1);
    expect(darkBeats[0].title).toBe('Dark Beat');
  });
});
