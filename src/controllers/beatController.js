import { BeatService } from '../services/beatService.js';
import logger from '../../logger.js';

/**
 * Controller para manejar las operaciones CRUD de beats
 */
export class BeatController {
  /**
   * UPLOAD URL - Generate presigned URL for direct S3 upload
   * POST /api/v1/beats/upload-url
   */
  static async getUploadUrl(req, res) {
    try {
      const { extension, mimetype, size } = req.body;

      // Validaciones básicas
      if (!extension || !mimetype) {
        return res.status(400).json({
          success: false,
          message: 'Extension and mimetype are required',
        });
      }

      // Validar tamaño (máximo 50MB)
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (size && size > maxSize) {
        return res.status(400).json({
          success: false,
          message: `File size exceeds maximum allowed (${maxSize / 1024 / 1024}MB)`,
        });
      }

      // Obtener userId del usuario autenticado (si existe)
      const userId = req.user?.id || 'anonymous';

      const result = await BeatService.generatePresignedUploadUrl({
        extension: extension.replace('.', ''), // Remove leading dot if present
        mimetype,
        userId,
      });

      logger.info(`Upload URL generated for user: ${userId}`);

      res.status(200).json({
        success: true,
        message: 'Upload URL generated successfully',
        data: result,
      });
    } catch (error) {
      logger.error(`Error in getUploadUrl controller: ${error.message}`);

      // Handle validation errors from service
      if (error.message.includes('Invalid')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error generating upload URL',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * CREATE - Crear un nuevo beat
   * POST /api/v1/beats
   */
  static async createBeat(req, res) {
    try {
      const beatData = req.body;

      // Agregar información del usuario autenticado (viene de headers x-user-id, x-roles)
      if (req.user) {
        beatData.createdBy = {
          userId: req.user.id, // Este valor viene del header x-user-id
          username: req.user.username || req.user.id,
          roles: req.user.roles || [],
        };
      }

      const newBeat = await BeatService.createBeat(beatData);

      logger.info(`Beat created via API: ${newBeat._id}`);

      res.status(201).json({
        success: true,
        message: 'Beat created successfully',
        data: newBeat,
      });
    } catch (error) {
      logger.error(`Error in createBeat controller: ${error.message}`);

      // Manejar errores de validación de Mongoose
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.values(error.errors).map((err) => ({
            field: err.path,
            message: err.message,
          })),
        });
      }

      // Error de duplicado (si tienes índices únicos)
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'Beat with this information already exists',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * READ ALL - Obtener todos los beats con paginación
   * GET /api/v1/beats
   */
  static async getAllBeats(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        genre,
        minBpm,
        maxBpm,
        tags,
        isFree,
      } = req.query;

      const filters = {};
      if (genre) filters.genre = genre;
      if (minBpm) filters.minBpm = parseInt(minBpm);
      if (maxBpm) filters.maxBpm = parseInt(maxBpm);
      if (tags) filters.tags = tags.split(',');
      if (isFree !== undefined) filters.isFree = isFree === 'true';

      const options = {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 50), // Máximo 50 por página
        sortBy,
        sortOrder,
        ...filters,
      };

      const result = await BeatService.getAllBeats(options);

      res.status(200).json({
        success: true,
        message: 'Beats retrieved successfully',
        data: result.beats,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error(`Error in getAllBeats controller: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Error retrieving beats',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * READ ONE - Obtener un beat por ID
   * GET /api/v1/beats/:id
   */
  static async getBeatById(req, res) {
    try {
      // Si el middleware requireBeatAccess ya cargó el beat, usarlo
      let beat = req.beat;

      // Si no, cargarlo (para compatibilidad con rutas sin middleware)
      if (!beat) {
        const { id } = req.params;
        beat = await BeatService.getBeatById(id);

        if (!beat) {
          return res.status(404).json({
            success: false,
            message: 'Beat not found',
          });
        }
      }

      res.status(200).json({
        success: true,
        message: 'Beat retrieved successfully',
        data: beat,
      });
    } catch (error) {
      logger.error(`Error in getBeatById controller: ${error.message}`);

      // Error de ID inválido
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid beat ID format',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error retrieving beat',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * UPDATE - Actualizar un beat
   * PUT /api/v1/beats/:id
   */
  static async updateBeat(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Remover campos que no se deben actualizar directamente
      delete updateData._id;
      delete updateData.createdAt;
      delete updateData.createdBy; // No permitir cambiar el creador
      delete updateData.stats; // Las stats se actualizan por métodos específicos

      const updatedBeat = await BeatService.updateBeat(id, updateData);

      if (!updatedBeat) {
        return res.status(404).json({
          success: false,
          message: 'Beat not found',
        });
      }

      logger.info(`Beat ${id} updated by user ${req.user?.id || 'unknown'}`);

      res.status(200).json({
        success: true,
        message: 'Beat updated successfully',
        data: updatedBeat,
      });
    } catch (error) {
      logger.error(`Error in updateBeat controller: ${error.message}`);

      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.values(error.errors).map((err) => ({
            field: err.path,
            message: err.message,
          })),
        });
      }

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid beat ID format',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating beat',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * DELETE - Eliminar un beat
   * DELETE /api/v1/beats/:id
   */
  static async deleteBeat(req, res) {
    try {
      const { id } = req.params;

      const deleted = await BeatService.deleteBeatPermanently(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Beat not found',
        });
      }

      logger.info(`Beat ${id} deleted by user ${req.user?.id || 'unknown'}`);

      res.status(200).json({
        success: true,
        message: 'Beat deleted successfully',
      });
    } catch (error) {
      logger.error(`Error in deleteBeat controller: ${error.message}`);

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid beat ID format',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error deleting beat',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * SEARCH - Buscar beats por término
   * GET /api/v1/beats/search
   */
  static async searchBeats(req, res) {
    try {
      const { q: searchTerm, page = 1, limit = 10 } = req.query;

      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long',
        });
      }

      const beats = await BeatService.searchBeats(searchTerm.trim(), {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 50),
      });

      res.status(200).json({
        success: true,
        message: 'Search completed successfully',
        data: beats,
        searchTerm: searchTerm.trim(),
      });
    } catch (error) {
      logger.error(`Error in searchBeats controller: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Error performing search',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * PLAY - Incrementar reproducciones
   * POST /api/v1/beats/:id/play
   * Requiere autenticación. Si el beat es privado, solo el propietario puede reproducirlo.
   */
  static async playBeat(req, res) {
    try {
      const { id } = req.params;

      // El middleware requireBeatAccess ya verificó permisos y cargó el beat
      const beat = await BeatService.incrementPlays(id);

      if (!beat) {
        return res.status(404).json({
          success: false,
          message: 'Beat not found',
        });
      }

      logger.info(`Beat ${id} played by user ${req.user.id}`);

      res.status(200).json({
        success: true,
        message: 'Play count updated',
        data: {
          beatId: id,
          plays: beat.stats.plays,
        },
      });
    } catch (error) {
      logger.error(`Error in playBeat controller: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Error updating play count',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * MY BEATS - Obtener beats del usuario autenticado
   * GET /api/v1/beats/my-beats
   */
  static async getMyBeats(req, res) {
    try {
      const userId = req.user.id;

      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        includePrivate = 'true',
        genre,
        minBpm,
        maxBpm,
        tags,
        isFree,
      } = req.query;

      const filters = {};
      if (genre) filters.genre = genre;
      if (minBpm) filters.minBpm = parseInt(minBpm);
      if (maxBpm) filters.maxBpm = parseInt(maxBpm);
      if (tags) filters.tags = tags.split(',');
      if (isFree !== undefined) filters.isFree = isFree === 'true';

      const options = {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 50), // Máximo 50 por página
        sortBy,
        sortOrder,
        includePrivate: includePrivate === 'true',
        ...filters,
      };

      const result = await BeatService.getUserBeats(userId, options);

      res.status(200).json({
        success: true,
        message: 'User beats retrieved successfully',
        data: result.beats,
        pagination: result.pagination,
        userId: result.userId,
      });
    } catch (error) {
      logger.error(`Error in getMyBeats controller: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Error retrieving user beats',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * STATS - Obtener estadísticas generales
   * GET /api/v1/beats/stats
   */
  static async getStats(req, res) {
    try {
      const stats = await BeatService.getBeatsStats();

      res.status(200).json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: stats,
      });
    } catch (error) {
      logger.error(`Error in getStats controller: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Error retrieving statistics',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
}
