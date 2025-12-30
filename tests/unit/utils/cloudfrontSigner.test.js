/**
 * Tests para CloudFront Signer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock de @aws-sdk/cloudfront-signer
vi.mock('@aws-sdk/cloudfront-signer', () => ({
  getSignedUrl: vi.fn(
    () => 'https://example.cloudfront.net/test?Signature=xxx'
  ),
}));

// Mock del logger
vi.mock('../../../logger.js', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('CloudFront Signer', () => {
  const originalEnv = process.env;

  // Clave PEM de prueba (NO usar en producción)
  const testPrivateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBALRiMLAHudeSA2ai1p/H0ueHpBF7/OiAPL5HqKKbA3pBHVJBpHlW
vPdKJCPGLzZrBCJqPdPDJHKKfvLOBxvyhWECAwEAAQJAYPpGbSzzIxEhJKGnT5K0
SzdPa9FBI1thqMyUvJpCRtbwU6KLwlPEJHnuBSLMpZBSMxPnOgSlVmD+OlJXrQ9t
QQIhAOL8p/FGOJRQwquDQVvwS/GhnhOUBrqLyPzJRe5kFpIZAiEAytCQqPrFbcGo
TxVBo3PXCJ7JSvcL8dxBMzqHJqKT5tkCIQCQk/OqC/mxddQPnPR6Px7ywDc4gJLH
J8fLBB0KZJRG6QIgNe50qXY/uy4CEfJdIw3FQ8rZIqj+EvGo3qXIqCYbXvECIA5Y
B6JPqMoXMvpCdKIcJiJjU4H5dI9H7cTYuY5HzWaL
-----END RSA PRIVATE KEY-----`;

  const testPrivateKeyBase64 = Buffer.from(testPrivateKey).toString('base64');

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CLOUDFRONT_KEY_PAIR_ID: 'K2JCJMDEHXQW5F',
      CLOUDFRONT_PRIVATE_KEY_BASE64: testPrivateKeyBase64,
      CDN_DOMAIN: 'https://d1234567890.cloudfront.net',
      CLOUDFRONT_URL_EXPIRATION: '3600',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('generateSignedUrl', () => {
    it('debe generar una URL firmada correctamente', async () => {
      const { generateSignedUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      const url = generateSignedUrl('beats/audio/test.mp3');

      expect(url).toBeDefined();
      expect(typeof url).toBe('string');
    });

    it('debe usar el tiempo de expiración personalizado', async () => {
      const { getSignedUrl } = await import('@aws-sdk/cloudfront-signer');
      const { generateSignedUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      generateSignedUrl('beats/audio/test.mp3', { expiresIn: 7200 });

      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('debe lanzar error si falta CLOUDFRONT_KEY_PAIR_ID', async () => {
      delete process.env.CLOUDFRONT_KEY_PAIR_ID;

      const { generateSignedUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      expect(() => generateSignedUrl('test.mp3')).toThrow();
    });

    it('debe lanzar error si falta CLOUDFRONT_PRIVATE_KEY_BASE64', async () => {
      delete process.env.CLOUDFRONT_PRIVATE_KEY_BASE64;

      const { generateSignedUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      expect(() => generateSignedUrl('test.mp3')).toThrow();
    });
  });

  describe('generateSignedUrls', () => {
    it('debe generar múltiples URLs firmadas', async () => {
      const { generateSignedUrls } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      const urls = generateSignedUrls([
        'beats/audio/beat1.mp3',
        'beats/audio/beat2.mp3',
      ]);

      expect(Object.keys(urls)).toHaveLength(2);
      expect(urls['beats/audio/beat1.mp3']).toBeDefined();
      expect(urls['beats/audio/beat2.mp3']).toBeDefined();
    });
  });

  describe('generateBeatAudioUrl', () => {
    it('debe generar URL con el path correcto para audio', async () => {
      const { getSignedUrl } = await import('@aws-sdk/cloudfront-signer');
      const { generateBeatAudioUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      generateBeatAudioUrl('beat123', 'track.mp3');

      expect(getSignedUrl).toHaveBeenCalled();
      // Verify the URL contains the correct path structure
      const callArg = getSignedUrl.mock.calls[0][0];
      expect(callArg.url).toContain('/beats/beat123/audio/track.mp3');
    });
  });

  describe('generateBeatCoverUrl', () => {
    it('debe generar URL con el path correcto para cover', async () => {
      const { getSignedUrl } = await import('@aws-sdk/cloudfront-signer');
      const { generateBeatCoverUrl } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      generateBeatCoverUrl('beat123', 'cover.jpg');

      expect(getSignedUrl).toHaveBeenCalled();
      // Verify the URL contains the correct path structure
      const callArg = getSignedUrl.mock.calls[0][0];
      expect(callArg.url).toContain('/beats/beat123/cover/cover.jpg');
    });
  });

  describe('checkCloudFrontConfig', () => {
    it('debe retornar configuración válida cuando todo está configurado', async () => {
      const { checkCloudFrontConfig } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      const status = checkCloudFrontConfig();

      expect(status.isConfigured).toBe(true);
      expect(status.errors).toHaveLength(0);
    });

    it('debe detectar configuración faltante', async () => {
      delete process.env.CLOUDFRONT_KEY_PAIR_ID;
      delete process.env.CDN_DOMAIN;

      const { checkCloudFrontConfig } = await import(
        '../../../src/utils/cloudfrontSigner.js'
      );

      const status = checkCloudFrontConfig();

      expect(status.isConfigured).toBe(false);
      expect(status.errors.length).toBeGreaterThan(0);
    });
  });
});
