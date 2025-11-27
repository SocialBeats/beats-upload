import { Beat } from '../models/index.js';
import logger from '../../logger.js';

export class BeatService {
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
      const beat = await Beat.findByIdAndUpdate(beatId, updateData, {
        new: true, // Retorna el documento actualizado
        runValidators: true, // Ejecuta las validaciones del schema
      });

      if (!beat) {
        logger.warn(`Beat not found for update: ${beatId}`);
        return null;
      }

      logger.info(`Beat updated successfully: ${beatId}`);
      return beat;
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
      const result = await Beat.findByIdAndDelete(beatId);

      if (!result) {
        logger.warn(`Beat not found for permanent deletion: ${beatId}`);
        return false;
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
