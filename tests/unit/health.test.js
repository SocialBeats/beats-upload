import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, toobusyMock } from '../setup/setup';

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    // Reset and ensure toobusy returns false for each test
    toobusyMock.mockReturnValue(false);
  });

  it('should return 200 and the health payload', async () => {
    const res = await api.get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('message', 'Health check successful');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('db', 'connected');
  });
});
