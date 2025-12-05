import { Beat } from '../models/index.js';
import logger from '../../logger.js';
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac'];
const ALLOWED_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac',
  'audio/x-m4a',
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export class BeatService {
  /**
   * Generate presigned URL for direct S3 upload
   * @param {Object} params - Upload parameters
   * @param {string} params.extension - File extension (mp3, wav, etc.)
   * @param {string} params.mimetype - MIME type of the file
   * @param {string} params.userId - User ID for folder structure
   * @returns {Promise<Object>} Presigned URL and s3Key
   */
  static async generatePresignedUploadUrl({
    extension,
    mimetype,
    size,
    userId,
  }) {
    try {
      // Validate size
      if (size && size > MAX_FILE_SIZE) {
        throw new Error(
          `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`
        );
      }

      // Validate extension
      if (!ALLOWED_EXTENSIONS.includes(extension.toLowerCase())) {
        throw new Error(
          `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
        );
      }

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(mimetype.toLowerCase())) {
        throw new Error(
          `Invalid MIME type. Expected audio format, got: ${mimetype}`
        );
      }

      // Generate unique filename with UUID v4
      const uuid = randomUUID();
      const s3Key = `users/${userId || 'anonymous'}/${uuid}.${extension}`;

      // Create presigned PUT URL
      const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        ContentType: mimetype,
      });

      // URL valid for 60 seconds
      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 60,
      });

      logger.info('Presigned URL generated', { s3Key, userId });

      return {
        uploadUrl,
        s3Key,
        expiresIn: 60,
      };
    } catch (error) {
      logger.error('Error generating presigned URL', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate presigned URL for audio playback
   * @param {string} beatId - ID of the beat
   * @returns {Promise<string>} Presigned URL
   */
  static async getAudioPresignedUrl(beatId) {
    try {
      const beat = await Beat.findById(beatId);
      if (!beat || !beat.audio?.s3Key) {
        throw new Error('Beat or audio file not found');
      }

      // Return CloudFront URL
      const cdnDomain = process.env.CDN_DOMAIN || '';
      // Ensure we handle potential slash inconsistencies
      const baseUrl = cdnDomain.endsWith('/')
        ? cdnDomain.slice(0, -1)
        : cdnDomain;
      const key = beat.audio.s3Key.startsWith('/')
        ? beat.audio.s3Key.slice(1)
        : beat.audio.s3Key;

      return `${baseUrl}/${key}`;
    } catch (error) {
      logger.error('Error generating audio URL', {
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
      const beat = new Beat(beatData);
      const savedBeat = await beat.save();
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
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        ...filters
      } = options;

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      // Usar el método estático del modelo para filtros
      const query = Beat.findWithFilters(filters);

      const [beats, totalBeats] = await Promise.all([
        query.skip(skip).limit(parseInt(limit)).sort(sort),
        Beat.countDocuments(query.getQuery()),
      ]);

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
        if (
          updateData.audio?.s3Key &&
          updateData.audio.s3Key !== oldBeat.audio?.s3Key
        ) {
          try {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: updateData.audio.s3Key,
              })
            );
            logger.info('Compensated: Deleted orphaned new S3 file', {
              s3Key: updateData.audio.s3Key,
            });
          } catch (s3Error) {
            logger.error('Failed to compensate new S3 file deletion', {
              s3Key: updateData.audio.s3Key,
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
        updateData.audio?.s3Key &&
        oldBeat.audio.s3Key !== updateData.audio.s3Key
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
      const beat = await Beat.findById(beatId);
      if (!beat) {
        return null;
      }

      return await beat.incrementPlays();
    } catch (error) {
      logger.error('Error incrementing plays', {
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
          { artist: { $regex: searchTerm, $options: 'i' } },
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
      if (filters.isFree !== undefined)
        query['pricing.isFree'] = filters.isFree;

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
