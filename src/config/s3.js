/**
 * S3 Client Configuration with Stability Controls
 *
 * This module provides a configured S3 client with built-in resilience:
 * - toobusy-js: Guards against event loop lag (prevents server overload)
 * - bottleneck: Limits concurrent S3 operations to prevent resource exhaustion
 *
 * @module config/s3
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import Bottleneck from 'bottleneck';
import toobusy from 'toobusy-js';
import logger from '../../logger.js';

/**
 * Custom error class for server overload scenarios
 * Used when toobusy-js detects high event loop lag
 */
export class ServerOverloadError extends Error {
  constructor(message = 'Server is too busy, please try again later') {
    super(message);
    this.name = 'ServerOverloadError';
    this.statusCode = 503;
    this.retryAfter = 5; // seconds
  }
}

/**
 * S3 Client configured for AWS
 */
export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

/**
 * Bottleneck limiter for S3 operations
 * Limits concurrent S3 requests to prevent overwhelming the service
 *
 * Configuration:
 * - maxConcurrent: Maximum 5 simultaneous S3 operations
 * - minTime: No minimum time between requests (0ms)
 * - reservoir: Optional burst control (not used here)
 */
const s3Limiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.S3_MAX_CONCURRENT || '5', 10),
  minTime: parseInt(process.env.S3_MIN_TIME || '0', 10),
});

// Log when limiter queues requests
s3Limiter.on('queued', () => {
  const queued = s3Limiter.queued();
  if (queued > 0) {
    logger.debug('S3 operation queued', { queuedCount: queued });
  }
});

/**
 * Guard clause to check if server is overloaded
 * Should be called BEFORE any S3 operation
 *
 * @throws {ServerOverloadError} If event loop lag exceeds threshold
 */
function checkServerLoad() {
  if (toobusy()) {
    logger.warn('S3 operation rejected: server too busy', {
      eventLoopLag: toobusy.lag(),
    });
    throw new ServerOverloadError();
  }
}

/**
 * Execute an S3 command with stability controls
 * 1. Checks toobusy (guard clause)
 * 2. Schedules through Bottleneck (concurrency control)
 * 3. Executes the actual S3 command
 *
 * @param {Object} command - AWS SDK command to execute
 * @returns {Promise<Object>} S3 response
 * @throws {ServerOverloadError} If server is overloaded
 */
export async function executeS3Command(command) {
  // Guard clause: reject immediately if server is overloaded
  checkServerLoad();

  // Schedule through Bottleneck for concurrency control
  return s3Limiter.schedule(async () => {
    logger.debug('Executing S3 command', {
      commandName: command.constructor.name,
    });
    return s3Client.send(command);
  });
}

/**
 * Generate a presigned POST URL with stability controls
 *
 * @param {Object} params - Parameters for createPresignedPost
 * @returns {Promise<Object>} Presigned POST data { url, fields }
 * @throws {ServerOverloadError} If server is overloaded
 */
export async function generatePresignedPostUrl(params) {
  // Guard clause: reject immediately if server is overloaded
  checkServerLoad();

  // Schedule through Bottleneck for concurrency control
  return s3Limiter.schedule(async () => {
    logger.debug('Generating presigned POST URL', {
      bucket: params.Bucket,
      key: params.Key,
    });
    return createPresignedPost(s3Client, params);
  });
}

/**
 * Generate a presigned GET URL with stability controls
 *
 * @param {Object} command - GetObjectCommand instance
 * @param {Object} options - Options like { expiresIn: 300 }
 * @returns {Promise<string>} Presigned URL
 * @throws {ServerOverloadError} If server is overloaded
 */
export async function generatePresignedGetUrl(command, options = {}) {
  // Guard clause: reject immediately if server is overloaded
  checkServerLoad();

  // Schedule through Bottleneck for concurrency control
  return s3Limiter.schedule(async () => {
    logger.debug('Generating presigned GET URL', {
      bucket: command.input.Bucket,
    });
    return getSignedUrl(s3Client, command, options);
  });
}

/**
 * Get current limiter statistics
 * Useful for health checks and monitoring
 *
 * @returns {Object} Limiter stats
 */
export function getLimiterStats() {
  return {
    running: s3Limiter.running(),
    queued: s3Limiter.queued(),
    done: s3Limiter.done(),
  };
}

// Re-export command classes for convenience
export { PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
