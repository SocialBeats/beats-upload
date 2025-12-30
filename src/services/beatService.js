import { Beat } from '../models/index.js';
import logger from '../../logger.js';
import { producer, isKafkaEnabled } from './kafkaConsumer.js';
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { parseStream } from 'music-metadata';
import { randomUUID } from 'crypto';
import {
  generateSignedUrl as generateCloudFrontSignedUrl,
  checkCloudFrontConfig,
} from '../utils/cloudfrontSigner.js';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'jpg',
  'jpeg',
  'png',
  'webp',
];
const ALLOWED_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac',
  'audio/x-m4a',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB - Enforced by S3 Policy
const PRESIGNED_URL_EXPIRY = 60; // 60 seconds

export class BeatService {
  /**
   * Generate presigned POST URL for direct S3 upload with strict policies.
   * Uses S3 POST policy conditions to enforce file size limits server-side.
   *
   * @param {Object} params - Upload parameters
   * @param {string} params.extension - File extension (mp3, wav, etc.)
   * @param {string} params.mimetype - MIME type of the file
   * @param {string} params.userId - User ID for folder structure
   * @returns {Promise<Object>} Presigned POST data: { url, fields, fileKey }
   */
  static async generatePresignedUploadUrl({
    extension,
    mimetype,
    size,
    userId,
  }) {
    try {
      // Validate size (client-side check, S3 policy enforces server-side)
      if (size && size > MAX_FILE_SIZE) {
        throw new Error(
          `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`
        );
      }

      // Validate extension
      const normalizedExt = extension.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(normalizedExt)) {
        throw new Error(
          `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
        );
      }

      // Validate MIME type
      const normalizedMime = mimetype.toLowerCase();
      if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
        throw new Error(
          `Invalid MIME type. Expected audio/image format, got: ${mimetype}`
        );
      }

      // Generate unique filename with UUID v4
      const uuid = randomUUID();
      const safeUserId = userId || 'anonymous';
      const fileKey = `users/${safeUserId}/${uuid}.${normalizedExt}`;

      // Create presigned POST with strict S3 policy conditions
      const { url, fields } = await createPresignedPost(s3Client, {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: fileKey,
        Conditions: [
          // Enforce max file size: 15MB (enforced by S3, cannot be bypassed)
          ['content-length-range', 0, MAX_FILE_SIZE],
          // Enforce exact Content-Type match
          ['eq', '$Content-Type', normalizedMime],
          // Enforce key prefix (user can only upload to their folder)
          ['starts-with', '$key', `users/${safeUserId}/`],
        ],
        Fields: {
          'Content-Type': normalizedMime,
        },
        Expires: PRESIGNED_URL_EXPIRY,
      });

      logger.info('Presigned POST URL generated', {
        fileKey,
        userId: safeUserId,
        maxSize: MAX_FILE_SIZE,
        contentType: normalizedMime,
      });

      return {
        url,
        fields,
        fileKey,
        expiresIn: PRESIGNED_URL_EXPIRY,
        maxFileSize: MAX_FILE_SIZE,
      };
    } catch (error) {
      logger.error('Error generating presigned POST URL', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Generate presigned URL for audio playback
   * Uses CloudFront signed URLs. Throws error if not configured.
   * @param {string} beatId - ID of the beat
   * @returns {Promise<string>} CloudFront Signed URL
   */
  static async getAudioPresignedUrl(beatId) {
    try {
      const beat = await Beat.findById(beatId);
      if (!beat || !beat.audio?.s3Key) {
        throw new Error('Beat or audio file not found');
      }

      // Normalize the S3 key (remove leading slash if present)
      const key = beat.audio.s3Key.startsWith('/')
        ? beat.audio.s3Key.slice(1)
        : beat.audio.s3Key;

      // Check CloudFront configuration
      const cloudFrontStatus = checkCloudFrontConfig();

      if (!cloudFrontStatus.isConfigured) {
        logger.error('CloudFront signing not configured!', {
          errors: cloudFrontStatus.errors,
          beatId,
        });
        throw new Error(
          'CloudFront signing is not configured. ' +
            'Set CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY_BASE64, and CLOUDFRONT_DOMAIN in environment variables.'
        );
      }

      // Generate signed URL
      const signedUrl = generateCloudFrontSignedUrl(key, {
        expiresIn: 7200, // 2 hours for streaming
      });

      logger.debug('Generated CloudFront signed URL', { beatId, key });
      return signedUrl;
    } catch (error) {
      logger.error('Error generating audio URL', {
        error: error.message,
        beatId,
      });
      throw error;
    }
  }

  /**
   * Generate presigned URL for audio download (forces save as)
   * @param {string} beatId - ID of the beat
   * @returns {Promise<string>} S3 Presigned URL with Content-Disposition
   */
  static async getDownloadPresignedUrl(beatId) {
    try {
      const beat = await Beat.findById(beatId);
      if (!beat || !beat.audio?.s3Key) {
        throw new Error('Beat or audio file not found');
      }

      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: beat.audio.s3Key,
        ResponseContentDisposition: `attachment; filename="${beat.audio.filename || 'beat.mp3'}"`,
      });

      // Valid for 5 minutes
      const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
      return url;
    } catch (error) {
      logger.error('Error generating download URL', {
        error: error.message,
        beatId,
      });
      throw error;
    }
  }

  /**
   * Crear un nuevo beat
   * @param {Object} beatData - Datos del beat a crear
   * @returns {Promise<Object>} Beat creado
   */
  static async createBeat(beatData) {
    try {
      // Validate audio file content
      if (beatData.audio?.s3Key) {
        try {
          const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: beatData.audio.s3Key,
          });
          const { Body } = await s3Client.send(command);

          const metadata = await parseStream(Body);

          // Check if it has audio codec
          if (!metadata.format.codec) {
            throw new Error('File is not a valid audio file');
          }

          // Optional: Verify it matches the declared mimetype if needed
          // const detectedMime = metadata.format.container;
        } catch (validationError) {
          logger.error('Audio validation failed', {
            error: validationError.message,
            s3Key: beatData.audio.s3Key,
          });
          throw new Error(
            `Audio validation failed: ${validationError.message}. Please ensure you are uploading a valid audio file.`
          );
        }
      }
      // Ensure metrics field exists and start as 'pending' so other services/frontend
      // can detect that metrics are being computed.
      beatData.metrics = beatData.metrics || {};
      // Do not overwrite an explicit value set upstream, but ensure default pending
      if (!beatData.metrics.status) {
        beatData.metrics.status = 'pending';
      }

      const beat = new Beat(beatData);
      const savedBeat = await beat.save();
      logger.info('Beat created successfully', { beatId: savedBeat._id });

      // Iniciar generación de waveform en background (fire and forget)
      // Importamos dinámicamente para evitar dependencias circulares si las hubiera, aunque aquí es limpio.
      // Pero mejor: import al inicio del archivo si no hay ciclo.
      // Como no definí import arriba para no romper diff, lo hago aquí o asumo que lo añadiste.
      // Voy a asumir que puedo añadir el import arriba en otro paso, o usar import dinámico aquí.
      // Usaré import dinámico para ser seguro y no tocar imports arriba ahora mismo.
      import('./waveformService.js').then(({ WaveformService }) => {
        WaveformService.generateAndSaveWaveform(savedBeat, s3Client).catch(
          (err) =>
            logger.error('Background waveform generation failed', {
              error: err.message,
            })
        );
      });

      if (isKafkaEnabled()) {
        try {
          // Use toJSON() to ensure virtuals like audio.url are included
          const beatPayload = savedBeat.toJSON();
          await producer.send({
            topic: 'beats-events',
            messages: [
              {
                value: JSON.stringify({
                  type: 'BEAT_CREATED',
                  payload: beatPayload,
                }),
              },
            ],
          });
          logger.info('Published BEAT_CREATED to Kafka', {
            beatId: savedBeat._id,
            topic: 'beats-events',
          });
        } catch (kafkaError) {
          logger.error('Failed to publish BEAT_CREATED event', {
            error: kafkaError.message,
          });
        }
      }

      logger.info('Beat created successfully', { beatId: savedBeat._id });
      return savedBeat;
    } catch (error) {
      logger.error('Error creating beat', { error: error.message });

      // Compensation: Delete uploaded files if DB save fails
      if (beatData.audio?.s3Key) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: beatData.audio.s3Key,
            })
          );
          logger.info('Compensated: Deleted orphaned S3 file', {
            s3Key: beatData.audio.s3Key,
          });
        } catch (s3Error) {
          logger.error('Failed to compensate S3 file deletion', {
            s3Key: beatData.audio.s3Key,
            error: s3Error.message,
          });
        }
      }

      if (beatData.audio?.s3CoverKey) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: beatData.audio.s3CoverKey,
            })
          );
          logger.info('Compensated: Deleted orphaned S3 cover', {
            s3Key: beatData.audio.s3CoverKey,
          });
        } catch (s3Error) {
          logger.error('Failed to compensate S3 cover deletion', {
            s3Key: beatData.audio.s3CoverKey,
            error: s3Error.message,
          });
        }
      }

      throw error;
    }
  }

  /**
   * Obtener todos los beats con paginación y filtros
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Lista de beats con metadata
   */
  static async getAllBeats(options = {}) {
    try {
      // ============ [DEBUG-TRACE] SERVICIO - ENTRADA ============
      logger.info(
        '[DEBUG-TRACE] BeatService.getAllBeats - Options recibidos:',
        JSON.stringify(options, null, 2)
      );
      // ============================================================

      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        ...filters
      } = options;

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      // ============ [DEBUG-TRACE] FILTROS EXTRAÍDOS ============
      logger.info(
        '[DEBUG-TRACE] Filtros extraídos de options:',
        JSON.stringify(filters, null, 2)
      );
      logger.info(
        '[DEBUG-TRACE] Paginación: skip=' +
          skip +
          ', limit=' +
          limit +
          ', sort=' +
          JSON.stringify(sort)
      );
      // ============================================================

      // Usar el método estático del modelo para filtros
      const query = Beat.findWithFilters(filters);

      // ============ [DEBUG-TRACE] QUERY OBJECT (CRÍTICO) ============
      const queryFilter = query.getQuery();
      logger.info(
        '[DEBUG-TRACE] 🔍 QUERY OBJECT completo que se enviará a MongoDB:',
        JSON.stringify(queryFilter, null, 2)
      );
      logger.info(
        '[DEBUG-TRACE] 🔍 Query con options: skip=' +
          skip +
          ', limit=' +
          limit +
          ', sort=' +
          JSON.stringify(sort)
      );
      // ============================================================

      const [beats, totalBeats] = await Promise.all([
        query.skip(skip).limit(parseInt(limit)).sort(sort),
        Beat.countDocuments(query.getQuery()),
      ]);

      // ============ [DEBUG-TRACE] RAW DATA DE BD ============
      logger.info('[DEBUG-TRACE] 📦 Respuesta RAW de MongoDB:');
      logger.info('[DEBUG-TRACE] - Tipo de beats:', typeof beats);
      logger.info(
        '[DEBUG-TRACE] - Array.isArray(beats):',
        Array.isArray(beats)
      );
      logger.info('[DEBUG-TRACE] - beats.length:', beats?.length);
      logger.info('[DEBUG-TRACE] - totalBeats (count):', totalBeats);
      if (beats && beats.length > 0) {
        logger.info(
          '[DEBUG-TRACE] - Primer beat (sample):',
          JSON.stringify(
            {
              _id: beats[0]._id,
              title: beats[0].title,
              isPublic: beats[0].isPublic,
              createdAt: beats[0].createdAt,
              audio: beats[0].audio
                ? { s3Key: beats[0].audio.s3Key, url: beats[0].audio.url }
                : 'NO AUDIO',
            },
            null,
            2
          )
        );
      } else {
        logger.info('[DEBUG-TRACE] ⚠️ NO HAY BEATS EN LA RESPUESTA');
      }
      // ============================================================

      const pagination = this._getPaginationMetadata(totalBeats, page, limit);

      logger.info('Retrieved beats', {
        count: beats.length,
        page,
        totalPages: pagination.totalPages,
      });

      return {
        beats,
        pagination,
      };
    } catch (error) {
      logger.error('Error fetching beats', { error: error.message });
      throw error;
    }
  }

  /**
   * Obtener un beat por ID
   * @param {string} beatId - ID del beat
   * @returns {Promise<Object|null>} Beat encontrado o null
   */
  static async getBeatById(beatId) {
    try {
      const beat = await Beat.findById(beatId);
      if (!beat) {
        logger.warn('Beat not found', { beatId });
        return null;
      }
      logger.info('Beat retrieved', { beatId });
      return beat;
    } catch (error) {
      logger.error('Error fetching beat', { beatId, error: error.message });
      throw error;
    }
  }

  /**
   * Actualizar un beat
   * @param {string} beatId - ID del beat a actualizar
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object|null>} Beat actualizado o null
   */
  static async updateBeat(beatId, updateData) {
    try {
      // Remove protected fields
      delete updateData._id;
      delete updateData.createdAt;
      delete updateData.createdBy;
      delete updateData.stats;

      // CRITICAL: Flatten 'audio' object to dot notation to prevent overwriting
      // the entire 'audio' subdocument (which would erase 'waveform' and 'isWaveformGenerated')
      let newS3Key = null;
      if (updateData.audio) {
        newS3Key = updateData.audio.s3Key;
        if (typeof updateData.audio === 'object') {
          for (const [key, value] of Object.entries(updateData.audio)) {
            updateData[`audio.${key}`] = value;
          }
          delete updateData.audio;
        }
      }

      // 1. Obtener el beat original para saber si hay que borrar archivo viejo
      const oldBeat = await Beat.findById(beatId);

      if (!oldBeat) {
        logger.warn('Beat not found for update', { beatId });
        return null;
      }

      // 2. Actualizar en Base de Datos PRIMERO
      let updatedBeat;
      try {
        updatedBeat = await Beat.findByIdAndUpdate(beatId, updateData, {
          new: true, // Retorna el documento actualizado
          runValidators: true, // Ejecuta las validaciones del schema
        });
      } catch (dbError) {
        // Compensation: If DB update fails, delete the NEW file if one was uploaded
        if (newS3Key && newS3Key !== oldBeat.audio?.s3Key) {
          try {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: newS3Key,
              })
            );
            logger.info('Compensated: Deleted orphaned new S3 file', {
              s3Key: newS3Key,
            });
          } catch (s3Error) {
            logger.error('Failed to compensate new S3 file deletion', {
              s3Key: newS3Key,
              error: s3Error.message,
            });
          }
        }
        throw dbError;
      }

      // 3. Si la actualización de BD fue exitosa Y cambió el archivo, borrar el viejo de S3
      if (
        updatedBeat &&
        oldBeat.audio?.s3Key &&
        newS3Key &&
        oldBeat.audio.s3Key !== newS3Key
      ) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: oldBeat.audio.s3Key,
            })
          );
          logger.info('Old audio file deleted from S3', {
            s3Key: oldBeat.audio.s3Key,
          });
        } catch (s3Error) {
          // No fallamos la request si falla S3, solo logueamos (archivo huérfano)
          logger.error('Failed to delete old S3 file', {
            s3Key: oldBeat.audio.s3Key,
            error: s3Error.message,
          });
        }
      }

      logger.info('Beat updated successfully', { beatId });

      if (isKafkaEnabled()) {
        try {
          // Use toJSON() to ensure virtuals like audio.url are included
          const beatPayload = updatedBeat.toJSON();
          await producer.send({
            topic: 'beats-events',
            messages: [
              {
                value: JSON.stringify({
                  type: 'BEAT_UPDATED',
                  payload: beatPayload,
                }),
              },
            ],
          });
          logger.info('Published BEAT_UPDATED to Kafka', {
            beatId,
            topic: 'beats-events',
          });
        } catch (kafkaError) {
          logger.error('Failed to publish BEAT_UPDATED event', {
            error: kafkaError.message,
          });
        }
      }

      return updatedBeat;
    } catch (error) {
      logger.error('Error updating beat', { beatId, error: error.message });
      throw error;
    }
  }

  /**
   * Eliminar permanentemente un beat
   * @param {string} beatId - ID del beat a eliminar
   * @returns {Promise<boolean>} true si se eliminó correctamente
   */
  static async deleteBeatPermanently(beatId) {
    try {
      // 1. Buscar el beat para tener las keys de S3 antes de borrar
      const beat = await Beat.findById(beatId);

      if (!beat) {
        logger.warn('Beat not found for deletion', { beatId });
        return false;
      }

      // 2. Borrar de Base de Datos PRIMERO
      const result = await Beat.findByIdAndDelete(beatId);

      if (!result) {
        // Esto sería raro si ya lo encontramos, pero por concurrencia podría pasar
        return false;
      }

      // 3. Si se borró de BD, intentar borrar archivos de S3
      // Audio
      if (beat.audio?.s3Key) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: beat.audio.s3Key,
            })
          );
          logger.info('S3 Object deleted', { s3Key: beat.audio.s3Key });
        } catch (s3Error) {
          logger.error('Failed to delete S3 file', {
            s3Key: beat.audio.s3Key,
            error: s3Error.message,
          });
        }
      }

      // Cover (si existe)
      if (beat.audio?.s3CoverKey) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: beat.audio.s3CoverKey,
            })
          );
          logger.info('S3 Cover deleted', { s3Key: beat.audio.s3CoverKey });
        } catch (s3Error) {
          logger.error('Failed to delete S3 cover', {
            s3Key: beat.audio.s3CoverKey,
            error: s3Error.message,
          });
        }
      }

      logger.info('Beat permanently deleted', { beatId });

      if (isKafkaEnabled()) {
        try {
          await producer.send({
            topic: 'beats-events',
            messages: [
              {
                value: JSON.stringify({
                  type: 'BEAT_DELETED',
                  payload: { _id: beatId },
                }),
              },
            ],
          });
          logger.info('Published BEAT_DELETED to Kafka', {
            beatId,
            topic: 'beats-events',
          });
        } catch (kafkaError) {
          logger.error('Failed to publish BEAT_DELETED event', {
            error: kafkaError.message,
          });
        }
      }

      return true;
    } catch (error) {
      logger.error('Error permanently deleting beat', {
        beatId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Incrementar reproducciones de un beat
   * @param {string} beatId - ID del beat
   * @returns {Promise<Object|null>} Beat actualizado
   */
  static async incrementPlays(beatId) {
    try {
      // Usar operación atómica $inc para evitar condiciones de carrera
      const updatedBeat = await Beat.findByIdAndUpdate(
        beatId,
        { $inc: { 'stats.plays': 1 } },
        { new: true }
      );

      if (!updatedBeat) {
        return null; // Beat no encontrado
      }

      if (isKafkaEnabled()) {
        try {
          await producer.send({
            topic: 'beats-events',
            messages: [
              {
                value: JSON.stringify({
                  type: 'BEAT_PLAYS_INCREMENTED',
                  payload: updatedBeat,
                }),
              },
            ],
          });
        } catch (kafkaError) {
          logger.error(
            'Failed to publish BEAT_PLAYS_INCREMENTED event (incrementPlays)',
            {
              error: kafkaError.message,
            }
          );
        }
      }

      return updatedBeat;
    } catch (error) {
      logger.error('Error incrementing plays', {
        beatId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Incrementar descargas de un beat
   * @param {string} beatId - ID del beat
   * @returns {Promise<Object|null>} Beat actualizado
   */
  static async incrementDownloads(beatId) {
    try {
      // Usar operación atómica $inc para evitar condiciones de carrera
      const updatedBeat = await Beat.findByIdAndUpdate(
        beatId,
        { $inc: { 'stats.downloads': 1 } },
        { new: true }
      );

      if (!updatedBeat) {
        return null;
      }

      if (isKafkaEnabled()) {
        try {
          await producer.send({
            topic: 'beats-events',
            messages: [
              {
                value: JSON.stringify({
                  type: 'BEAT_DOWNLOADS_INCREMENTED',
                  payload: updatedBeat,
                }),
              },
            ],
          });
        } catch (kafkaError) {
          logger.error('Failed to publish BEAT_DOWNLOADS_INCREMENTED event', {
            error: kafkaError.message,
          });
        }
      }

      return updatedBeat;
    } catch (error) {
      logger.error('Error incrementing downloads', {
        beatId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Buscar beats por texto
   * @param {string} searchTerm - Término de búsqueda
   * @param {Object} options - Opciones de búsqueda
   * @returns {Promise<Array>} Beats encontrados
   */
  static async searchBeats(searchTerm, options = {}) {
    try {
      const { page = 1, limit = 10 } = options;
      const skip = (page - 1) * limit;

      const searchQuery = {
        $or: [
          { title: { $regex: searchTerm, $options: 'i' } },
          { 'createdBy.username': { $regex: searchTerm, $options: 'i' } },
          { tags: { $regex: searchTerm, $options: 'i' } },
          { description: { $regex: searchTerm, $options: 'i' } },
        ],
        isPublic: true,
      };

      const beats = await Beat.find(searchQuery)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ 'stats.plays': -1 });

      logger.info('Search completed', { searchTerm, count: beats.length });
      return beats;
    } catch (error) {
      logger.error('Error searching beats', {
        searchTerm,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Obtener beats del usuario autenticado
   * @param {string} userId - ID del usuario
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Lista de beats del usuario con metadata
   */
  static async getUserBeats(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        includePrivate = true,
        ...filters
      } = options;

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      // Query base: beats del usuario
      const baseQuery = { 'createdBy.userId': userId };

      // Si no se incluyen privados, filtrar solo públicos
      if (!includePrivate) {
        baseQuery.isPublic = true;
      }

      // Aplicar filtros adicionales si se proporcionan
      const query = { ...baseQuery };
      if (filters.genre) query.genre = filters.genre;
      if (filters.tags) query.tags = { $in: filters.tags };

      const [beats, totalBeats] = await Promise.all([
        Beat.find({ ...query })
          .skip(skip)
          .limit(parseInt(limit))
          .sort(sort),
        Beat.countDocuments({ ...query }),
      ]);

      const pagination = this._getPaginationMetadata(totalBeats, page, limit);

      logger.info('Retrieved user beats', {
        userId,
        count: beats.length,
        page,
        totalPages: pagination.totalPages,
      });

      return {
        beats,
        pagination,
        userId,
      };
    } catch (error) {
      logger.error('Error fetching user beats', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Obtener estadísticas generales
   * @returns {Promise<Object>} Estadísticas de beats
   */
  static async getBeatsStats() {
    try {
      const stats = await Beat.aggregate([
        {
          $group: {
            _id: null,
            totalBeats: { $sum: 1 },
            totalPlays: { $sum: '$stats.plays' },
            totalDownloads: { $sum: '$stats.downloads' },
          },
        },
      ]);

      const genreStats = await Beat.aggregate([
        { $group: { _id: '$genre', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);

      return {
        general: stats[0] || {},
        genres: genreStats,
      };
    } catch (error) {
      logger.error('Error fetching beats stats', { error: error.message });
      throw error;
    }
  }

  static _getPaginationMetadata(totalItems, page, limit) {
    const totalPages = Math.ceil(totalItems / limit);
    return {
      currentPage: parseInt(page),
      totalPages,
      totalBeats: totalItems,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
}
