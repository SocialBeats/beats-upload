import { vi } from 'vitest';
import request from 'supertest';

// Use vi.hoisted to ensure mock is available before module import
// This prevents "Cannot access before initialization" errors
const mocks = vi.hoisted(() => {
  const toobusyFn = vi.fn(() => false);
  toobusyFn.lag = vi.fn(() => 10);
  toobusyFn.maxLag = vi.fn();
  toobusyFn.shutdown = vi.fn();
  return { toobusy: toobusyFn };
});

// Mock toobusy-js globally BEFORE any other imports
// This ensures tests don't get 503 responses from server load detection
vi.mock('toobusy-js', () => ({
  default: mocks.toobusy,
}));

// Now import app and database
import app from '../../main.js';
import { connectDB, disconnectDB } from '../../src/db.js';

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await disconnectDB();
});

// Export a ready-to-use Supertest instance
export const api = request(app);

// Export mock for tests that need to control toobusy behavior
export const toobusyMock = mocks.toobusy;
