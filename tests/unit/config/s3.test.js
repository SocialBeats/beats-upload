import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted for mocks that need to be available before module imports
const mocks = vi.hoisted(() => {
  const toobusyFn = Object.assign(
    vi.fn(() => false),
    {
      lag: vi.fn(() => 50),
      maxLag: vi.fn(),
      shutdown: vi.fn(),
    }
  );

  const scheduleFn = vi.fn((fn) => fn());
  const s3SendFn = vi.fn();
  const createPresignedPostFn = vi.fn();
  const getSignedUrlFn = vi.fn();

  return {
    toobusy: toobusyFn,
    schedule: scheduleFn,
    s3Send: s3SendFn,
    createPresignedPost: createPresignedPostFn,
    getSignedUrl: getSignedUrlFn,
  };
});

vi.mock('toobusy-js', () => ({
  default: mocks.toobusy,
}));

// Mock bottleneck as a proper class constructor
vi.mock('bottleneck', () => {
  return {
    default: class MockBottleneck {
      constructor() {
        this.schedule = mocks.schedule;
        this.on = vi.fn();
        this.queued = vi.fn(() => 0);
        this.running = vi.fn(() => 0);
        this.done = vi.fn(() => 0);
      }
    },
  };
});

// Mock AWS SDK with proper class constructor
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class MockS3Client {
      constructor() {
        this.send = mocks.s3Send;
      }
    },
    GetObjectCommand: class MockGetObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    PutObjectCommand: class MockPutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    DeleteObjectCommand: class MockDeleteObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
  };
});

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: mocks.createPresignedPost,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

// Mock logger
vi.mock('../../../logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('S3 Config - Stability Controls', () => {
  let s3Module;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.toobusy.mockReturnValue(false);
    mocks.s3Send.mockResolvedValue({ Body: 'mock-body' });
    mocks.createPresignedPost.mockResolvedValue({
      url: 'https://s3.test.com',
      fields: {},
    });
    mocks.getSignedUrl.mockResolvedValue('https://s3.test.com/signed-url');

    // Reset modules to get fresh instance
    vi.resetModules();
    s3Module = await import('../../../src/config/s3.js');
  });

  describe('ServerOverloadError', () => {
    it('should create error with correct properties', () => {
      const error = new s3Module.ServerOverloadError();

      expect(error.name).toBe('ServerOverloadError');
      expect(error.message).toBe('Server is too busy, please try again later');
      expect(error.statusCode).toBe(503);
      expect(error.retryAfter).toBe(5);
    });

    it('should accept custom message', () => {
      const error = new s3Module.ServerOverloadError('Custom overload message');

      expect(error.message).toBe('Custom overload message');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('executeS3Command', () => {
    it('should execute S3 command when server is not busy', async () => {
      mocks.toobusy.mockReturnValue(false);
      mocks.s3Send.mockResolvedValue({ Body: 'test-body' });

      const mockCommand = {
        input: { Bucket: 'test' },
        constructor: { name: 'GetObjectCommand' },
      };
      const result = await s3Module.executeS3Command(mockCommand);

      expect(mocks.toobusy).toHaveBeenCalled();
      expect(mocks.schedule).toHaveBeenCalled();
      expect(result).toEqual({ Body: 'test-body' });
    });

    it('should throw ServerOverloadError when server is too busy', async () => {
      mocks.toobusy.mockReturnValue(true);
      mocks.toobusy.lag.mockReturnValue(150);

      const mockCommand = {
        input: { Bucket: 'test' },
        constructor: { name: 'GetObjectCommand' },
      };

      await expect(s3Module.executeS3Command(mockCommand)).rejects.toThrow(
        s3Module.ServerOverloadError
      );
      await expect(s3Module.executeS3Command(mockCommand)).rejects.toThrow(
        'Server is too busy, please try again later'
      );
    });

    it('should use Bottleneck to schedule the operation', async () => {
      mocks.toobusy.mockReturnValue(false);
      mocks.s3Send.mockResolvedValue({ success: true });

      const mockCommand = {
        input: { Bucket: 'test' },
        constructor: { name: 'PutObjectCommand' },
      };
      await s3Module.executeS3Command(mockCommand);

      expect(mocks.schedule).toHaveBeenCalledTimes(1);
      expect(mocks.schedule).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('generatePresignedPostUrl', () => {
    it('should generate presigned POST URL when server is not busy', async () => {
      mocks.toobusy.mockReturnValue(false);
      mocks.createPresignedPost.mockResolvedValue({
        url: 'https://bucket.s3.amazonaws.com',
        fields: { key: 'test-key', Policy: 'base64policy' },
      });

      const params = {
        Bucket: 'test-bucket',
        Key: 'users/123/file.mp3',
        Conditions: [],
        Fields: { 'Content-Type': 'audio/mpeg' },
        Expires: 60,
      };

      const result = await s3Module.generatePresignedPostUrl(params);

      expect(mocks.toobusy).toHaveBeenCalled();
      expect(mocks.schedule).toHaveBeenCalled();
      expect(result.url).toBe('https://bucket.s3.amazonaws.com');
      expect(result.fields).toHaveProperty('key', 'test-key');
    });

    it('should throw ServerOverloadError when server is too busy', async () => {
      mocks.toobusy.mockReturnValue(true);

      const params = { Bucket: 'test', Key: 'test.mp3' };

      await expect(s3Module.generatePresignedPostUrl(params)).rejects.toThrow(
        s3Module.ServerOverloadError
      );
    });
  });

  describe('generatePresignedGetUrl', () => {
    it('should generate presigned GET URL when server is not busy', async () => {
      mocks.toobusy.mockReturnValue(false);
      mocks.getSignedUrl.mockResolvedValue(
        'https://bucket.s3.amazonaws.com/file.mp3?signature=xyz'
      );

      const command = { input: { Bucket: 'test-bucket', Key: 'file.mp3' } };
      const options = { expiresIn: 300 };

      const result = await s3Module.generatePresignedGetUrl(command, options);

      expect(mocks.toobusy).toHaveBeenCalled();
      expect(mocks.schedule).toHaveBeenCalled();
      expect(result).toBe(
        'https://bucket.s3.amazonaws.com/file.mp3?signature=xyz'
      );
    });

    it('should throw ServerOverloadError when server is too busy', async () => {
      mocks.toobusy.mockReturnValue(true);

      const command = { input: { Bucket: 'test', Key: 'file.mp3' } };

      await expect(s3Module.generatePresignedGetUrl(command)).rejects.toThrow(
        s3Module.ServerOverloadError
      );
    });
  });

  describe('getLimiterStats', () => {
    it('should return limiter statistics', () => {
      const stats = s3Module.getLimiterStats();

      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('done');
    });
  });
});

describe('S3 Config - Concurrency Control', () => {
  it('should queue multiple concurrent requests through Bottleneck', async () => {
    vi.clearAllMocks();
    mocks.toobusy.mockReturnValue(false);

    let callCount = 0;
    mocks.schedule.mockImplementation(async (fn) => {
      callCount++;
      return fn();
    });
    mocks.s3Send.mockResolvedValue({ success: true });

    vi.resetModules();
    const s3Module = await import('../../../src/config/s3.js');

    // Simulate 3 concurrent S3 operations
    const command1 = {
      input: { Bucket: 'test' },
      constructor: { name: 'GetObjectCommand' },
    };
    const command2 = {
      input: { Bucket: 'test' },
      constructor: { name: 'GetObjectCommand' },
    };
    const command3 = {
      input: { Bucket: 'test' },
      constructor: { name: 'GetObjectCommand' },
    };

    await Promise.all([
      s3Module.executeS3Command(command1),
      s3Module.executeS3Command(command2),
      s3Module.executeS3Command(command3),
    ]);

    // All should have been scheduled through Bottleneck
    expect(callCount).toBe(3);
  });
});

describe('S3 Config - Integration with toobusy', () => {
  it('should reject requests immediately when event loop is lagging', async () => {
    vi.clearAllMocks();

    // Simulate high event loop lag
    mocks.toobusy.mockReturnValue(true);
    mocks.toobusy.lag.mockReturnValue(200); // 200ms lag

    vi.resetModules();
    const s3Module = await import('../../../src/config/s3.js');

    const command = {
      input: { Bucket: 'test' },
      constructor: { name: 'GetObjectCommand' },
    };

    // Should reject immediately without queuing
    const startTime = Date.now();

    try {
      await s3Module.executeS3Command(command);
      expect.fail('Should have thrown ServerOverloadError');
    } catch (error) {
      const elapsed = Date.now() - startTime;

      expect(error).toBeInstanceOf(s3Module.ServerOverloadError);
      expect(error.statusCode).toBe(503);
      // Should reject almost immediately (< 50ms)
      expect(elapsed).toBeLessThan(50);
    }
  });
});
