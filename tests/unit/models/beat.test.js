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
      bpm: 120,
      duration: 180,
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
    expect(err.errors.bpm).toBeDefined();
    expect(err.errors.duration).toBeDefined();
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

  it('should fail validation if price is invalid for paid beat', async () => {
    const paidBeatWithInvalidPrice = new Beat({
      title: 'Paid Beat',
      artist: 'Test Artist',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/paid.mp3',
        filename: 'paid.mp3',
        size: 1024,
        format: 'mp3',
      },
      pricing: {
        isFree: false,
        price: 0,
      },
    });
    let err;
    try {
      await paidBeatWithInvalidPrice.save();
    } catch (error) {
      err = error;
    }
    expect(err).toBeDefined();
    expect(err.message).toBe('Paid beats must have a price greater than 0');
  });

  it('should format duration correctly via virtual', async () => {
    const beat = new Beat({
      title: 'Test Beat',
      artist: 'Test Artist',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 125, // 2 minutes 5 seconds
      audio: {
        s3Key: 'beats/test.mp3',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    expect(beat.formattedDuration).toBe('2:05');
  });

  it('should return correct audioUrl via virtual', async () => {
    process.env.CDN_DOMAIN = 'https://cdn.example.com';
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
    expect(beat.audioUrl).toBe('https://cdn.example.com/beats/test.mp3');
  });

  it('should return correct coverUrl via virtual', async () => {
    process.env.CDN_DOMAIN = 'https://cdn.example.com';
    const beat = new Beat({
      title: 'Test Beat',
      artist: 'Test Artist',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: 'beats/test.mp3',
        s3CoverKey: 'covers/test.jpg',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    expect(beat.coverUrl).toBe('https://cdn.example.com/covers/test.jpg');
  });

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

  it('should return fullUrl virtual property', async () => {
    const originalBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = 'https://api.example.com';

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

    expect(savedBeat.fullUrl).toContain(
      'https://api.example.com/api/v1/beats/'
    );
    expect(savedBeat.fullUrl).toContain(savedBeat._id.toString());

    process.env.BASE_URL = originalBaseUrl;
  });

  it('should return default fullUrl when BASE_URL is not set', async () => {
    const originalBaseUrl = process.env.BASE_URL;
    delete process.env.BASE_URL;

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

    expect(savedBeat.fullUrl).toContain('http://localhost:3000/api/v1/beats/');

    process.env.BASE_URL = originalBaseUrl;
  });

  it('should return null for audioUrl when audio is missing', () => {
    const beat = new Beat({
      title: 'Test Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        s3Key: '',
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    beat.audio = undefined;
    expect(beat.audioUrl).toBeNull();
  });

  it('should return null for audioUrl when s3Key is missing', () => {
    const beat = new Beat({
      title: 'Test Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      audio: {
        filename: 'test.mp3',
        size: 1024,
        format: 'mp3',
      },
    });
    expect(beat.audioUrl).toBeNull();
  });

  it('should return null for coverUrl when audio is missing', () => {
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
    beat.audio = undefined;
    expect(beat.coverUrl).toBeNull();
  });

  it('should return null for coverUrl when s3CoverKey is missing', () => {
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
    expect(beat.coverUrl).toBeNull();
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

  it('should find beats with minBpm filter', async () => {
    const beat1 = new Beat({
      title: 'Slow Beat',
      genre: 'Jazz',
      bpm: 80,
      duration: 180,
      audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
      isPublic: true,
    });
    const beat2 = new Beat({
      title: 'Fast Beat',
      genre: 'Electronic',
      bpm: 140,
      duration: 180,
      audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
      isPublic: true,
    });
    await beat1.save();
    await beat2.save();

    const fastBeats = await Beat.findWithFilters({ minBpm: 120 });
    expect(fastBeats).toHaveLength(1);
    expect(fastBeats[0].title).toBe('Fast Beat');
  });

  it('should find beats with maxBpm filter', async () => {
    await Beat.deleteMany({});

    const beat1 = new Beat({
      title: 'Slow Beat',
      genre: 'Jazz',
      bpm: 80,
      duration: 180,
      audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
      isPublic: true,
    });
    const beat2 = new Beat({
      title: 'Fast Beat',
      genre: 'Electronic',
      bpm: 140,
      duration: 180,
      audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
      isPublic: true,
    });
    await beat1.save();
    await beat2.save();

    const slowBeats = await Beat.findWithFilters({ maxBpm: 100 });
    expect(slowBeats).toHaveLength(1);
    expect(slowBeats[0].title).toBe('Slow Beat');
  });

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

  it('should find beats with isFree filter', async () => {
    await Beat.deleteMany({});

    const freeBeat = new Beat({
      title: 'Free Beat',
      genre: 'Hip Hop',
      bpm: 120,
      duration: 180,
      pricing: { isFree: true, price: 0 },
      audio: { s3Key: 'k1', filename: 'f1', size: 1, format: 'mp3' },
      isPublic: true,
    });
    const paidBeat = new Beat({
      title: 'Paid Beat',
      genre: 'Trap',
      bpm: 140,
      duration: 180,
      pricing: { isFree: false, price: 29.99 },
      audio: { s3Key: 'k2', filename: 'f2', size: 1, format: 'mp3' },
      isPublic: true,
    });
    await freeBeat.save();
    await paidBeat.save();

    const freeBeats = await Beat.findWithFilters({ isFree: true });
    expect(freeBeats).toHaveLength(1);
    expect(freeBeats[0].title).toBe('Free Beat');

    const paidBeats = await Beat.findWithFilters({ isFree: false });
    expect(paidBeats).toHaveLength(1);
    expect(paidBeats[0].title).toBe('Paid Beat');
  });
});
