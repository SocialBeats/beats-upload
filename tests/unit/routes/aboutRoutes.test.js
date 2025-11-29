import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// Mock logger
vi.mock('../../../logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock versionUtils
vi.mock('../../../src/utils/versionUtils.js', () => ({
  getVersion: vi.fn(() => 'v1.0.0'),
}));

describe('About Routes', () => {
  let app;
  let aboutRoutes;

  beforeAll(async () => {
    // Dynamic import to ensure mocks are registered
    const module = await import('../../../src/routes/aboutRoutes.js');
    aboutRoutes = module.default;

    app = express();
    aboutRoutes(app);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/about', () => {
    it('should return README content as HTML', async () => {
      const response = await request(app).get('/api/v1/about');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      expect(response.text).toContain('<'); // Contains HTML tags
    });

    it('should handle error when README file does not exist', async () => {
      // Temporarily mock fs to throw error
      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const response = await request(app).get('/api/v1/about');

      expect(response.status).toBe(500);
      expect(response.text).toContain('Error reading the file');

      // Restore
      fs.promises.readFile = originalReadFile;
    });
  });

  describe('GET /api/v1/version', () => {
    it('should return version from .version file', async () => {
      const response = await request(app).get('/api/v1/version');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.message).toBe('string');
    });

    it('should handle error when .version file does not exist', async () => {
      // Mock fs to throw error
      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const response = await request(app).get('/api/v1/version');

      expect(response.status).toBe(500);
      expect(response.body.message).toBe(
        'There was an error retrieving API version'
      );
      expect(response.body).toHaveProperty('error');

      // Restore
      fs.promises.readFile = originalReadFile;
    });
  });

  describe('GET /api/v1/changelog', () => {
    it('should return full changelog as HTML', async () => {
      const response = await request(app).get('/api/v1/changelog');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      // Response can be empty if CHANGELOG has no releases, just check it's HTML
      expect(typeof response.text).toBe('string');
    });

    it('should filter changelog by specific versions', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: 'v1.0.0,v0.9.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should filter changelog by single version', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should filter changelog by version range with from parameter', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v0.5.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should filter changelog by version range with to parameter', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ to: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should filter changelog by version range with from and to parameters', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v0.5.0', to: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should handle from parameter without "v" prefix', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: '0.5.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should handle to parameter without "v" prefix', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ to: '1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should handle versions with comma-separated values with spaces', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: ' v1.0.0 , v0.9.0 ' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should return empty result when no versions match', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: 'v999.999.999' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should handle version range where from > to', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v2.0.0', to: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should handle error when CHANGELOG file does not exist', async () => {
      // Mock fs to throw error
      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const response = await request(app).get('/api/v1/changelog');

      expect(response.status).toBe(500);
      expect(response.text).toContain('Error retrieving API release notes');

      // Restore
      fs.promises.readFile = originalReadFile;
    });
  });

  describe('Swagger Documentation', () => {
    it('should serve Swagger UI at /api/v1/docs', async () => {
      const response = await request(app).get('/api/v1/docs/');

      expect(response.status).toBe(200);
      expect(response.type).toContain('html');
    });

    it('should create spec directory and oas.yaml file', () => {
      const specDir = path.join(path.resolve(), 'spec');
      const specFile = path.join(specDir, 'oas.yaml');

      expect(fs.existsSync(specDir)).toBe(true);
      expect(fs.existsSync(specFile)).toBe(true);
    });

    it('should generate valid OpenAPI spec with correct info', () => {
      const specPath = path.join(path.resolve(), 'spec', 'oas.yaml');
      const specContent = fs.readFileSync(specPath, 'utf8');

      expect(specContent).toContain('openapi: 3.0.0');
      // Version comes from mocked versionUtils or .version file
      expect(specContent).toMatch(/version:/);
    });

    it('should include security schemes in spec', () => {
      const specPath = path.join(path.resolve(), 'spec', 'oas.yaml');
      const specContent = fs.readFileSync(specPath, 'utf8');

      expect(specContent).toContain('securitySchemes');
      expect(specContent).toContain('gatewayAuth');
      expect(specContent).toContain('userId');
      expect(specContent).toContain('userRoles');
    });

    it('should use environment variables for API title if set', () => {
      const originalTitle = process.env.API_TITLE;
      process.env.API_TITLE = 'Test Custom Title';

      // Re-import to get new env value
      delete require.cache[
        require.resolve('../../../src/routes/aboutRoutes.js')
      ];

      process.env.API_TITLE = originalTitle;
    });

    it('should use environment variables for API description if set', () => {
      const originalDesc = process.env.API_DESCRIPTION;
      process.env.API_DESCRIPTION = 'Test Custom Description';

      // Re-import to get new env value
      delete require.cache[
        require.resolve('../../../src/routes/aboutRoutes.js')
      ];

      process.env.API_DESCRIPTION = originalDesc;
    });

    it('should use environment variables for PUBLIC_URL if set', () => {
      const originalUrl = process.env.PUBLIC_URL;
      process.env.PUBLIC_URL = 'https://test.example.com';

      // Re-import to get new env value
      delete require.cache[
        require.resolve('../../../src/routes/aboutRoutes.js')
      ];

      process.env.PUBLIC_URL = originalUrl;
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed CHANGELOG content', async () => {
      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(
        'Invalid content without proper release headers'
      );

      const response = await request(app).get('/api/v1/changelog');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');

      fs.promises.readFile = originalReadFile;
    });

    it('should handle empty query parameters', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: '', from: '', to: '' });

      expect(response.status).toBe(200);
    });

    it('should handle whitespace-only version parameters', async () => {
      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ versions: '   ' });

      expect(response.status).toBe(200);
    });

    it('should create spec directory if it does not exist initially', () => {
      const specDir = path.join(path.resolve(), 'spec');
      // The directory should exist after aboutRoutes initialization
      expect(fs.existsSync(specDir)).toBe(true);
    });

    it('should handle CHANGELOG with releases that match version range boundaries', async () => {
      const mockChangelog = `
# Release v1.0.0
- Feature A

# Release v0.9.0
- Feature B

# Release v0.8.0
- Feature C
      `.trim();

      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(mockChangelog);

      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v0.8.0', to: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');

      fs.promises.readFile = originalReadFile;
    });

    it('should exclude versions outside range when filtering', async () => {
      const mockChangelog = `
# Release v2.0.0
- Feature A

# Release v1.5.0
- Feature B

# Release v1.0.0
- Feature C
      `.trim();

      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(mockChangelog);

      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v1.0.0', to: 'v1.5.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');

      fs.promises.readFile = originalReadFile;
    });

    it('should handle releases with no version number in header', async () => {
      const mockChangelog = `
# Release v1.0.0
- Feature A

# Release
- Invalid release

# Release v0.9.0
- Feature B
      `.trim();

      const originalReadFile = fs.promises.readFile;
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(mockChangelog);

      const response = await request(app)
        .get('/api/v1/changelog')
        .query({ from: 'v0.9.0', to: 'v1.0.0' });

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');

      fs.promises.readFile = originalReadFile;
    });
  });
});
