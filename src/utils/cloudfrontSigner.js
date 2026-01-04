/**
 * CloudFront Signed URL Generator
 *
 * Este módulo proporciona funciones para generar URLs firmadas de CloudFront
 * para acceso seguro a contenido privado en S3.
 *
 * @module utils/cloudfrontSigner
 */

import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import logger from '../../logger.js';

/**
 * Obtiene la configuración dinámicamente desde variables de entorno.
 * Se lee en cada llamada para permitir cambios en runtime y mejor testabilidad.
 * @returns {Object} Configuración de CloudFront
 */
function getConfig() {
  return {
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
    privateKeyBase64: process.env.CLOUDFRONT_PRIVATE_KEY_BASE64,
    cloudfrontDomain: process.env.CDN_DOMAIN,
    defaultExpiration: parseInt(
      process.env.CLOUDFRONT_URL_EXPIRATION || '3600',
      10
    ),
  };
}

/**
 * Decodifica la clave privada de Base64 a formato PEM
 * @returns {string} Clave privada en formato PEM
 * @throws {Error} Si la variable de entorno no está configurada
 */
function decodePrivateKey() {
  const config = getConfig();
  if (!config.privateKeyBase64) {
    throw new Error(
      'CLOUDFRONT_PRIVATE_KEY_BASE64 no está configurada. ' +
        'Ejecuta "node scripts/setup-cloudfront-keys.js" para generar las claves.'
    );
  }

  try {
    const privateKeyPem = Buffer.from(
      config.privateKeyBase64,
      'base64'
    ).toString('utf8');

    // Validar que es un PEM válido
    if (
      !privateKeyPem.includes('-----BEGIN') ||
      !privateKeyPem.includes('-----END')
    ) {
      throw new Error('La clave decodificada no tiene formato PEM válido');
    }

    return privateKeyPem;
  } catch (error) {
    logger.error('Error decodificando clave privada de CloudFront:', error);
    throw new Error(
      `Error decodificando CLOUDFRONT_PRIVATE_KEY_BASE64: ${error.message}`
    );
  }
}

/**
 * Valida que todas las variables de entorno necesarias estén configuradas
 * @throws {Error} Si falta alguna variable requerida
 */
function validateConfig() {
  const config = getConfig();
  const required = ['keyPairId', 'privateKeyBase64', 'cloudfrontDomain'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    const missingVars = missing.map((key) => {
      const envName = key.replace(/([A-Z])/g, '_$1').toUpperCase();
      return `CLOUDFRONT_${envName}`;
    });
    throw new Error(
      `Variables de entorno faltantes: ${missingVars.join(', ')}`
    );
  }
}

/**
 * Genera una URL firmada de CloudFront para acceder a un recurso privado
 *
 * @param {string} resourceKey - La clave/path del recurso en S3 (ej: "beats/audio/song.mp3")
 * @param {Object} [options={}] - Opciones adicionales
 * @param {number} [options.expiresIn] - Tiempo de expiración en segundos (default: 3600)
 * @param {Date} [options.dateLessThan] - Fecha de expiración específica
 * @returns {string} URL firmada de CloudFront
 *
 * @example
 * // URL que expira en 1 hora (default)
 * const url = generateSignedUrl('beats/audio/my-beat.mp3');
 *
 * @example
 * // URL que expira en 24 horas
 * const url = generateSignedUrl('beats/audio/my-beat.mp3', { expiresIn: 86400 });
 *
 * @example
 * // URL que expira en una fecha específica
 * const url = generateSignedUrl('beats/audio/my-beat.mp3', {
 *   dateLessThan: new Date('2025-12-31T23:59:59Z')
 * });
 */
export function generateSignedUrl(resourceKey, options = {}) {
  validateConfig();

  const config = getConfig();
  const privateKey = decodePrivateKey();
  const { expiresIn = config.defaultExpiration, dateLessThan } = options;

  // Normalize resourceKey: remove leading slashes to avoid double slashes in URL
  const normalizedKey = resourceKey.replace(/^\/+/, '');

  // Construir la URL del recurso
  const url = `${config.cloudfrontDomain}/${normalizedKey}`;

  // Calcular fecha de expiración
  const expiration = dateLessThan || new Date(Date.now() + expiresIn * 1000);

  try {
    const signedUrl = getSignedUrl({
      url,
      keyPairId: config.keyPairId,
      privateKey,
      dateLessThan: expiration.toISOString(),
    });

    logger.debug(`URL firmada generada para: ${resourceKey}`, {
      expiresAt: expiration.toISOString(),
    });

    return signedUrl;
  } catch (error) {
    logger.error('Error generando URL firmada de CloudFront:', {
      resourceKey,
      error: error.message,
    });
    throw new Error(`Error generando URL firmada: ${error.message}`);
  }
}

/**
 * Genera múltiples URLs firmadas para un conjunto de recursos
 *
 * @param {string[]} resourceKeys - Array de claves/paths de recursos
 * @param {Object} [options={}] - Opciones adicionales
 * @returns {Object} Objeto con resourceKey como clave y URL firmada como valor
 *
 * @example
 * const urls = generateSignedUrls([
 *   'beats/audio/beat1.mp3',
 *   'beats/audio/beat2.mp3',
 *   'beats/covers/cover1.jpg'
 * ]);
 * // { 'beats/audio/beat1.mp3': 'https://...', ... }
 */
export function generateSignedUrls(resourceKeys, options = {}) {
  const urls = {};

  for (const key of resourceKeys) {
    urls[key] = generateSignedUrl(key, options);
  }

  return urls;
}

/**
 * Genera una URL firmada específica para archivos de audio de beats
 *
 * @param {string} beatId - ID del beat
 * @param {string} filename - Nombre del archivo de audio
 * @param {Object} [options={}] - Opciones adicionales
 * @returns {string} URL firmada
 */
export function generateBeatAudioUrl(beatId, filename, options = {}) {
  const resourceKey = `beats/${beatId}/audio/${filename}`;
  return generateSignedUrl(resourceKey, options);
}

/**
 * Genera una URL firmada específica para imágenes de portada
 *
 * @param {string} beatId - ID del beat
 * @param {string} filename - Nombre del archivo de imagen
 * @param {Object} [options={}] - Opciones adicionales
 * @returns {string} URL firmada
 */
export function generateBeatCoverUrl(beatId, filename, options = {}) {
  const resourceKey = `beats/${beatId}/cover/${filename}`;
  return generateSignedUrl(resourceKey, options);
}

/**
 * Genera una URL firmada para streaming de audio con cabeceras de rango
 * Útil para reproductores de audio que necesitan seek/scrubbing
 *
 * @param {string} resourceKey - Clave del recurso
 * @param {Object} [options={}] - Opciones adicionales
 * @param {number} [options.expiresIn=7200] - Tiempo de expiración más largo para streaming
 * @returns {string} URL firmada optimizada para streaming
 */
export function generateStreamingUrl(resourceKey, options = {}) {
  // URLs de streaming tienen una expiración más larga por defecto
  const streamingOptions = {
    expiresIn: 7200, // 2 horas
    ...options,
  };

  return generateSignedUrl(resourceKey, streamingOptions);
}

/**
 * Verifica si la configuración de CloudFront está completa
 * Útil para health checks o validación en startup
 *
 * @returns {Object} Estado de la configuración
 */
export function checkCloudFrontConfig() {
  const config = getConfig();
  const status = {
    isConfigured: false,
    keyPairId: !!config.keyPairId,
    privateKey: !!config.privateKeyBase64,
    domain: !!config.cloudfrontDomain,
    errors: [],
  };

  if (!config.keyPairId) {
    status.errors.push('CLOUDFRONT_KEY_PAIR_ID no configurado');
  }

  if (!config.privateKeyBase64) {
    status.errors.push('CLOUDFRONT_PRIVATE_KEY_BASE64 no configurado');
  } else {
    // Validar que se puede decodificar
    try {
      decodePrivateKey();
    } catch (error) {
      status.errors.push(`Error en clave privada: ${error.message}`);
    }
  }

  if (!config.cloudfrontDomain) {
    status.errors.push('CDN_DOMAIN no configurado');
  }

  status.isConfigured = status.errors.length === 0;

  return status;
}

// Export default con todas las funciones
export default {
  generateSignedUrl,
  generateSignedUrls,
  generateBeatAudioUrl,
  generateBeatCoverUrl,
  generateStreamingUrl,
  checkCloudFrontConfig,
};
