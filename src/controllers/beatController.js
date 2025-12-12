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
      const userId = req.user?.id || 'anonymous';

      const result = await BeatService.generatePresignedUploadUrl({
        extension: extension ? extension.replace('.', '') : '',
        mimetype,
        size,
        userId,
      });

      logger.info('Upload URL generated', { userId, extension, mimetype });

      res.status(200).json({
        success: true,
        message: 'Upload URL generated successfully',
        data: result,
      });
    } catch (error) {
      logger.error('Error in getUploadUrl controller', {
        error: error.message,
      });

      // Handle validation errors from service
      if (
        error.message.includes('Invalid') ||
        error.message.includes('exceeds')
      ) {
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
   * STREAM AUDIO - Redirect to presigned URL for audio playback
   * GET /api/v1/beats/:id/audio
   */
  static async streamAudio(req, res) {
    try {
      const { id } = req.params;
      const presignedUrl = await BeatService.getAudioPresignedUrl(id);

      // Redirect to the S3 presigned URL
      res.redirect(presignedUrl);
    } catch (error) {
      logger.error('Error in streamAudio controller', {
        beatId: req.params.id,
        error: error.message,
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Beat or audio file not found',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error streaming audio',
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
          username: req.user.username,
          roles: req.user.roles || [],
        };
      }

      const newBeat = await BeatService.createBeat(beatData);

      logger.info('Beat created via API', {
        beatId: newBeat._id,
        userId: req.user?.id,
      });

      res.status(201).json({
        success: true,
        message: 'Beat created successfully',
        data: newBeat,
      });
    } catch (error) {
      logger.error('Error in createBeat controller', { error: error.message });

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
        tags,
      } = req.query;

      const filters = {};
      if (genre) filters.genre = genre;
      if (tags) filters.tags = tags.split(',');

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
      logger.error('Error in getAllBeats controller', { error: error.message });
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
      logger.error('Error in getBeatById controller', {
        beatId: req.params.id,
        error: error.message,
      });

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

      // Note: Protected fields removal is handled in the service

      const updatedBeat = await BeatService.updateBeat(id, updateData);

      if (!updatedBeat) {
        return res.status(404).json({
          success: false,
          message: 'Beat not found',
        });
      }

      logger.info('Beat updated via API', { beatId: id, userId: req.user?.id });

      res.status(200).json({
        success: true,
        message: 'Beat updated successfully',
        data: updatedBeat,
      });
    } catch (error) {
      logger.error('Error in updateBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });

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

      logger.info('Beat deleted via API', { beatId: id, userId: req.user?.id });

      res.status(200).json({
        success: true,
        message: 'Beat deleted successfully',
      });
    } catch (error) {
      logger.error('Error in deleteBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });

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
      logger.error('Error in searchBeats controller', {
        searchTerm: req.query.q,
        error: error.message,
      });
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

      logger.info('Beat played', { beatId: id, userId: req.user.id });

      res.status(200).json({
        success: true,
        message: 'Play count updated',
        data: {
          beatId: id,
          plays: beat.stats.plays,
        },
      });
    } catch (error) {
      logger.error('Error in playBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });
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
        tags,
      } = req.query;

      const filters = {};
      if (genre) filters.genre = genre;
      if (tags) filters.tags = tags.split(',');

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
      logger.error('Error in getMyBeats controller', {
        userId: req.user.id,
        error: error.message,
      });
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
      logger.error('Error in getStats controller', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Error retrieving statistics',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
}
