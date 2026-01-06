import { BeatService, ServerOverloadError } from '../services/beatService.js';
import logger from '../../logger.js';

/**
 * Helper function to handle ServerOverloadError consistently
 * Returns 503 Service Unavailable with retry-after header
 *
 * @param {Error} error - The error to check
 * @param {Response} res - Express response object
 * @returns {boolean} True if error was handled, false otherwise
 */
function handleOverloadError(error, res) {
  if (error instanceof ServerOverloadError) {
    res.set('x-retry-after', String(error.retryAfter || 5));
    res.status(503).json({
      success: false,
      error: 'Servicio no disponible',
      message: error.message,
    });
    return true;
  }
  return false;
}

/**
 * Controller para manejar las operaciones CRUD de beats
 */
export class BeatController {
  /**
   * UPLOAD URL - Generate presigned POST URL for direct S3 upload
   * POST /api/v1/beats/upload-url
   *
   * Returns presigned POST data with fields that must be included
   * in the multipart/form-data upload to S3.
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

      logger.info('Presigned POST URL generated', {
        userId,
        extension,
        mimetype,
        fileKey: result.fileKey,
      });

      res.status(200).json({
        success: true,
        message: 'URL de subida generada correctamente',
        data: {
          // S3 endpoint URL for POST upload
          url: result.url,
          // Required form fields (must be included in multipart/form-data)
          fields: result.fields,
          // S3 key to reference when creating the beat
          fileKey: result.fileKey,
          // URL expiration time in seconds
          expiresIn: result.expiresIn,
          // Maximum allowed file size in bytes
          maxFileSize: result.maxFileSize,
        },
      });
    } catch (error) {
      logger.error('Error in getUploadUrl controller', {
        error: error.message,
      });

      // Handle server overload (503)
      if (handleOverloadError(error, res)) return;

      // Handle validation errors from service
      if (
        error.message.includes('Inválido') ||
        error.message.includes('inválido') ||
        error.message.includes('inválida') ||
        error.message.includes('excede') ||
        error.message.includes('excedido') ||
        error.message.includes('alcanzado') ||
        error.message.includes('Necesitas mejorar') ||
        error.message.includes('Inconsistencia')
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al generar la URL de subida',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * STREAM AUDIO - Get signed CloudFront URLs for audio playback and cover
   * GET /api/v1/beats/:id/audio
   * Returns JSON with streamUrl and coverUrl for the frontend to use
   */
  static async streamAudio(req, res) {
    try {
      const { id } = req.params;
      const { streamUrl, coverUrl } =
        await BeatService.getAudioPresignedUrl(id);

      // Return JSON response for frontend consumption
      res.status(200).json({
        success: true,
        streamUrl,
        coverUrl, // May be null if beat has no cover
      });
    } catch (error) {
      logger.error('Error in streamAudio controller', {
        beatId: req.params.id,
        error: error.message,
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Beat o archivo de audio no encontrado',
        });
      }

      // Handle server overload (503)
      if (handleOverloadError(error, res)) return;

      res.status(500).json({
        success: false,
        message: 'Error al reproducir el audio',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * BATCH SIGNED URLS - Get signed URLs for multiple beats at once
   * POST /api/v1/beats/batch/signed-urls
   * Body: { beatIds: string[] }
   * Max 10 beats per request
   */
  static async getBatchSignedUrls(req, res) {
    try {
      const { beatIds } = req.body;

      // Validate input
      if (!Array.isArray(beatIds) || beatIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'beatIds debe ser un array no vacío',
        });
      }

      // Limit to 10 beats per request
      const MAX_BATCH_SIZE = 10;
      if (beatIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          success: false,
          message: `Máximo ${MAX_BATCH_SIZE} beats por solicitud`,
        });
      }

      const result = await BeatService.getBatchSignedUrls(beatIds);

      res.status(200).json({
        success: true,
        data: result.urls,
        meta: {
          requested: beatIds.length,
          resolved: result.resolved,
          errors: result.errors,
        },
        expiresIn: 7200, // 2 hours
      });
    } catch (error) {
      logger.error('Error in getBatchSignedUrls controller', {
        error: error.message,
      });

      // Handle server overload (503)
      if (handleOverloadError(error, res)) return;

      res.status(500).json({
        success: false,
        message: 'Error al generar URLs firmadas en lote',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * DOWNLOAD BEAT - Get download URL and increment stats
   * GET /api/v1/beats/:id/download
   */
  static async downloadBeat(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // 1. Get beat to check permissions
      const beat = await BeatService.getBeatById(id);

      if (!beat) {
        return res.status(404).json({
          success: false,
          message: 'Beat no encontrado',
        });
      }

      // 2. Check if downloadable
      if (!beat.isDownloadable) {
        return res.status(403).json({
          success: false,
          message: 'Este beat no está disponible para descargar',
        });
      }

      // 3. Increment downloads ONLY if not the owner
      const isOwner = userId && userId === beat.createdBy?.userId;

      let currentDownloads = beat.stats.downloads;

      if (!isOwner) {
        const updatedBeat = await BeatService.incrementDownloads(id, userId);
        currentDownloads = updatedBeat.stats.downloads;
      }

      // 4. Generate Download URL (may throw ServerOverloadError)
      const downloadUrl = await BeatService.getDownloadPresignedUrl(id);

      logger.info('Beat download initiated', { beatId: id, userId, isOwner });

      res.status(200).json({
        success: true,
        message: 'Enlace de descarga generado',
        data: {
          downloadUrl,
          stats: {
            downloads: currentDownloads,
            plays: beat.stats.plays,
          },
        },
      });
    } catch (error) {
      logger.error('Error in downloadBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });

      // Handle server overload (503)
      if (handleOverloadError(error, res)) return;

      // Handle plan/feature limit errors (400)
      if (
        error.message.includes('Necesitas mejorar tu plan') ||
        error.message.includes('no encontrado')
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al procesar la descarga',
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
        message: 'Beat creado correctamente',
        data: newBeat,
      });
    } catch (error) {
      logger.error('Error in createBeat controller', { error: error.message });

      // Handle server overload (503)
      if (handleOverloadError(error, res)) return;

      // Manejar errores de validación de Mongoose
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Error de validación',
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
          message: 'Ya existe un beat con esta información',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
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
        message: 'Beats obtenidos correctamente',
        data: result.beats,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error('Error in getAllBeats controller', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Error al obtener los beats',
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
            message: 'Beat no encontrado',
          });
        }
      }

      res.status(200).json({
        success: true,
        message: 'Beat obtenido correctamente',
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
          message: 'Formato de ID de beat inválido',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al obtener el beat',
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
          message: 'Beat no encontrado',
        });
      }

      logger.info('Beat updated via API', { beatId: id, userId: req.user?.id });

      res.status(200).json({
        success: true,
        message: 'Beat actualizado correctamente',
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
          message: 'Error de validación',
          errors: Object.values(error.errors).map((err) => ({
            field: err.path,
            message: err.message,
          })),
        });
      }

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Formato de ID de beat inválido',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al actualizar el beat',
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
          message: 'Beat no encontrado',
        });
      }

      logger.info('Beat deleted via API', { beatId: id, userId: req.user?.id });

      res.status(200).json({
        success: true,
        message: 'Beat eliminado correctamente',
      });
    } catch (error) {
      logger.error('Error in deleteBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Formato de ID de beat inválido',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al eliminar el beat',
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
          message: 'El término de búsqueda debe tener al menos 2 caracteres',
        });
      }

      const beats = await BeatService.searchBeats(searchTerm.trim(), {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 50),
      });

      res.status(200).json({
        success: true,
        message: 'Búsqueda completada correctamente',
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
        message: 'Error al realizar la búsqueda',
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
  /**
   * PLAY - Incrementar reproducciones
   * POST /api/v1/beats/:id/play
   * Requiere autenticación. Si el beat es privado, solo el propietario puede reproducirlo.
   */
  static async playBeat(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // El middleware requireBeatAccess ya verificó permisos y cargó el beat
      // Pero necesitamos el objeto beat para chequear el owner
      let beat = req.beat;

      // Si por alguna razón req.beat no está (aunque debería por el middleware), lo buscamos
      if (!beat) {
        beat = await BeatService.getBeatById(id);
      }

      if (!beat) {
        return res.status(404).json({
          success: false,
          message: 'Beat no encontrado',
        });
      }

      const isOwner = userId && userId === beat.createdBy?.userId;
      let currentPlays = beat.stats.plays;

      // Increment ONLY if not owner
      if (!isOwner) {
        const updatedBeat = await BeatService.incrementPlays(id);
        currentPlays = updatedBeat.stats.plays;
        logger.info('Beat played (stats incremented)', { beatId: id, userId });
      } else {
        logger.info('Beat played by owner (stats NOT incremented)', {
          beatId: id,
          userId,
        });
      }

      res.status(200).json({
        success: true,
        message: 'Contador de reproducciones actualizado',
        data: {
          beatId: id,
          plays: currentPlays,
        },
      });
    } catch (error) {
      logger.error('Error in playBeat controller', {
        beatId: req.params.id,
        error: error.message,
      });
      res.status(500).json({
        success: false,
        message: 'Error al actualizar el contador de reproducciones',
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
        message: 'Beats del usuario obtenidos correctamente',
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
        message: 'Error al obtener los beats del usuario',
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
        message: 'Estadísticas obtenidas correctamente',
        data: stats,
      });
    } catch (error) {
      logger.error('Error in getStats controller', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Error al obtener las estadísticas',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * TOGGLE PROMOTION - Toggle beat promotion status
   * PATCH /api/v1/beats/:id/promote
   *
   * Toggles the promoted status of a beat.
   * When promoting, validates that user has the promotedBeat feature.
   */
  static async togglePromotion(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Se requiere autenticación',
        });
      }

      const beat = await BeatService.togglePromotion(id, userId);

      res.status(200).json({
        success: true,
        message: beat.promoted
          ? 'Beat promocionado correctamente'
          : 'Promoción del beat eliminada',
        data: {
          beatId: beat._id,
          promoted: beat.promoted,
        },
      });
    } catch (error) {
      logger.error('Error in togglePromotion controller', {
        beatId: req.params.id,
        userId: req.user?.id,
        error: error.message,
      });

      // Handle specific errors (mensajes del service en español)
      if (error.message.includes('no encontrado')) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes('No autorizado')) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes('no disponible')) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error al cambiar el estado de promoción del beat',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
}
