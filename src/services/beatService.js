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

export class BeatService {
  /**
   * Generate presigned URL for direct S3 upload
   * @param {Object} params - Upload parameters
   * @param {string} params.extension - File extension (mp3, wav, etc.)
   * @param {string} params.mimetype - MIME type of the file
   * @param {string} params.userId - User ID for folder structure
   * @returns {Promise<Object>} Presigned URL and s3Key
   */
  static async generatePresignedUploadUrl({ extension, mimetype, userId }) {
    try {
      // Validate extension
      const allowedExtensions = ['mp3', 'wav', 'flac', 'aac'];
      if (!allowedExtensions.includes(extension.toLowerCase())) {
        throw new Error(
          `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`
        );
      }

      // Validate MIME type
      const allowedMimeTypes = [
        'audio/mpeg',
        'audio/wav',
        'audio/x-wav',
        'audio/flac',
        'audio/aac',
        'audio/x-m4a',
      ];
      if (!allowedMimeTypes.includes(mimetype.toLowerCase())) {
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

      logger.info(`Presigned URL generated for: ${s3Key}`);

      return {
        uploadUrl,
        s3Key,
        expiresIn: 60,
      };
    } catch (error) {
      logger.error(`Error generating presigned URL: ${error.message}`);
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
      logger.info(`Beat created successfully: ${savedBeat._id}`);
      return savedBeat;
    } catch (error) {
      logger.error(`Error creating beat: ${error.message}`);
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

      const totalPages = Math.ceil(totalBeats / limit);

      logger.info(
        `Retrieved ${beats.length} beats (page ${page}/${totalPages})`
      );

      return {
        beats,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalBeats,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error(`Error fetching beats: ${error.message}`);
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
        logger.warn(`Beat not found: ${beatId}`);
        return null;
      }
      logger.info(`Beat retrieved: ${beatId}`);
      return beat;
    } catch (error) {
      logger.error(`Error fetching beat ${beatId}: ${error.message}`);
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
      // 1. Obtener el beat original para saber si hay que borrar archivo viejo
      const oldBeat = await Beat.findById(beatId);

      if (!oldBeat) {
        logger.warn(`Beat not found for update: ${beatId}`);
        return null;
      }

      // 2. Actualizar en Base de Datos PRIMERO
      const updatedBeat = await Beat.findByIdAndUpdate(beatId, updateData, {
        new: true, // Retorna el documento actualizado
        runValidators: true, // Ejecuta las validaciones del schema
      });

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
          logger.info(`Old audio file deleted from S3: ${oldBeat.audio.s3Key}`);
        } catch (s3Error) {
          // No fallamos la request si falla S3, solo logueamos (archivo huérfano)
          logger.error(
            `Failed to delete old S3 file ${oldBeat.audio.s3Key}: ${s3Error.message}`
          );
        }
      }

      logger.info(`Beat updated successfully: ${beatId}`);
      return updatedBeat;
    } catch (error) {
      logger.error(`Error updating beat ${beatId}: ${error.message}`);
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
        logger.warn(`Beat not found for deletion: ${beatId}`);
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
          logger.info(`S3 Object deleted: ${beat.audio.s3Key}`);
        } catch (s3Error) {
          logger.error(
            `Failed to delete S3 file ${beat.audio.s3Key}: ${s3Error.message}`
          );
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
          logger.info(`S3 Cover deleted: ${beat.audio.s3CoverKey}`);
        } catch (s3Error) {
          logger.error(
            `Failed to delete S3 cover ${beat.audio.s3CoverKey}: ${s3Error.message}`
          );
        }
      }

      logger.info(`Beat permanently deleted: ${beatId}`);
      return true;
    } catch (error) {
      logger.error(
        `Error permanently deleting beat ${beatId}: ${error.message}`
      );
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
      logger.error(
        `Error incrementing plays for beat ${beatId}: ${error.message}`
      );
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

      logger.info(
        `Search for "${searchTerm}" returned ${beats.length} results`
      );
      return beats;
    } catch (error) {
      logger.error(`Error searching beats: ${error.message}`);
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
      if (filters.minBpm) query.bpm = { ...query.bpm, $gte: filters.minBpm };
      if (filters.maxBpm) query.bpm = { ...query.bpm, $lte: filters.maxBpm };
      if (filters.tags) query.tags = { $in: filters.tags };
      if (filters.isFree !== undefined)
        query['pricing.isFree'] = filters.isFree;

      const [beats, totalBeats] = await Promise.all([
        Beat.find(query).skip(skip).limit(parseInt(limit)).sort(sort),
        Beat.countDocuments(query),
      ]);

      const totalPages = Math.ceil(totalBeats / limit);

      logger.info(
        `Retrieved ${beats.length} beats for user ${userId} (page ${page}/${totalPages})`
      );

      return {
        beats,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalBeats,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        userId,
      };
    } catch (error) {
      logger.error(`Error fetching user beats for ${userId}: ${error.message}`);
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
            avgDuration: { $avg: '$duration' },
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
      logger.error(`Error fetching beats stats: ${error.message}`);
      throw error;
    }
  }
}
