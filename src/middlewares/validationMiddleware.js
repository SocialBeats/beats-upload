import logger from '../../logger.js';

/**
 * Validaciones para la creación de beats
 */
export const validateCreateBeat = (req, res, next) => {
  const { title, genre, audio } = req.body;
  const errors = [];

  // Validar campos requeridos
  if (!title || title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' });
  } else if (title.length > 100) {
    errors.push({
      field: 'title',
      message: 'Title cannot exceed 100 characters',
    });
  }

  // Validar género
  const validGenres = [
    'Hip Hop',
    'Trap',
    'R&B',
    'Pop',
    'Rock',
    'Electronic',
    'Jazz',
    'Reggaeton',
    'Other',
  ];
  if (!genre) {
    errors.push({ field: 'genre', message: 'Genre is required' });
  } else if (!validGenres.includes(genre)) {
    errors.push({
      field: 'genre',
      message: `Genre must be one of: ${validGenres.join(', ')}`,
    });
  }

  // Validar información de audio
  if (!audio) {
    errors.push({ field: 'audio', message: 'Audio information is required' });
  } else {
    if (!audio.s3Key || audio.s3Key.trim().length === 0) {
      errors.push({
        field: 'audio.s3Key',
        message: 'Audio S3 Key is required',
      });
    }
    if (!audio.filename || audio.filename.trim().length === 0) {
      errors.push({
        field: 'audio.filename',
        message: 'Audio filename is required',
      });
    }
    if (!audio.size || typeof audio.size !== 'number' || audio.size <= 0) {
      errors.push({
        field: 'audio.size',
        message: 'Audio size must be a positive number',
      });
    }
    const validFormats = ['mp3', 'wav', 'flac', 'aac'];
    if (!audio.format || !validFormats.includes(audio.format)) {
      errors.push({
        field: 'audio.format',
        message: `Audio format must be one of: ${validFormats.join(', ')}`,
      });
    }
  }

  // Validar key si está presente
  if (req.body.key) {
    const validKeys = [
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
    ];
    if (!validKeys.includes(req.body.key)) {
      errors.push({
        field: 'key',
        message: `Key must be one of: ${validKeys.join(', ')}`,
      });
    }
  }

  // Validar tags si están presentes
  if (req.body.tags) {
    if (!Array.isArray(req.body.tags)) {
      errors.push({ field: 'tags', message: 'Tags must be an array' });
    } else if (req.body.tags.length > 10) {
      errors.push({ field: 'tags', message: 'Maximum 10 tags allowed' });
    }
  }

  // Validar descripción si está presente
  if (req.body.description && req.body.description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description cannot exceed 500 characters',
    });
  }

  // Validar pricing si está presente
  if (req.body.pricing) {
    if (
      req.body.pricing.isFree === false &&
      (!req.body.pricing.price || req.body.pricing.price <= 0)
    ) {
      errors.push({
        field: 'pricing.price',
        message: 'Paid beats must have a price greater than 0',
      });
    }
  }

  // Si hay errores, devolverlos
  if (errors.length > 0) {
    logger.warn(`Validation failed for createBeat: ${JSON.stringify(errors)}`);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validaciones para la actualización de beats
 * Similar a createBeat pero todos los campos son opcionales
 */
export const validateUpdateBeat = (req, res, next) => {
  const errors = [];
  const { title, genre, key, tags, description, pricing } = req.body;

  // Validar title si está presente
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      errors.push({
        field: 'title',
        message: 'Title must be a non-empty string',
      });
    } else if (title.length > 100) {
      errors.push({
        field: 'title',
        message: 'Title cannot exceed 100 characters',
      });
    }
  }

  // Validar género si está presente
  if (genre !== undefined) {
    const validGenres = [
      'Hip Hop',
      'Trap',
      'R&B',
      'Pop',
      'Rock',
      'Electronic',
      'Jazz',
      'Reggaeton',
      'Other',
    ];
    if (!validGenres.includes(genre)) {
      errors.push({
        field: 'genre',
        message: `Genre must be one of: ${validGenres.join(', ')}`,
      });
    }
  }

  // Validar key si está presente
  if (key !== undefined) {
    const validKeys = [
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
    ];
    if (!validKeys.includes(key)) {
      errors.push({
        field: 'key',
        message: `Key must be one of: ${validKeys.join(', ')}`,
      });
    }
  }

  // Validar tags si están presentes
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      errors.push({ field: 'tags', message: 'Tags must be an array' });
    } else if (tags.length > 10) {
      errors.push({ field: 'tags', message: 'Maximum 10 tags allowed' });
    }
  }

  // Validar descripción si está presente
  if (description !== undefined && description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description cannot exceed 500 characters',
    });
  }

  // Validar pricing si está presente
  if (pricing !== undefined) {
    if (pricing.isFree === false && (!pricing.price || pricing.price <= 0)) {
      errors.push({
        field: 'pricing.price',
        message: 'Paid beats must have a price greater than 0',
      });
    }
  }

  // Prevenir actualización de campos sensibles
  const forbiddenFields = ['_id', 'createdAt', 'createdBy', 'stats'];
  forbiddenFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      errors.push({
        field,
        message: `Cannot update field '${field}' directly`,
      });
    }
  });

  if (errors.length > 0) {
    logger.warn(`Validation failed for updateBeat: ${JSON.stringify(errors)}`);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validación de parámetros de consulta para búsqueda y filtrado
 */
export const validateQueryParams = (req, res, next) => {
  const errors = [];
  const { page, limit, sortBy, sortOrder } = req.query;

  // Validar page
  if (page !== undefined) {
    const pageNum = parseInt(page);
    if (isNaN(pageNum) || pageNum < 1) {
      errors.push({
        field: 'page',
        message: 'Page must be a positive integer',
      });
    }
  }

  // Validar limit
  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      errors.push({
        field: 'limit',
        message: 'Limit must be an integer between 1 and 50',
      });
    }
  }

  // Validar sortBy
  if (sortBy !== undefined) {
    const validSortFields = [
      'createdAt',
      'title',
      'stats.plays',
      'pricing.price',
    ];
    if (!validSortFields.includes(sortBy)) {
      errors.push({
        field: 'sortBy',
        message: `sortBy must be one of: ${validSortFields.join(', ')}`,
      });
    }
  }

  // Validar sortOrder
  if (sortOrder !== undefined) {
    if (!['asc', 'desc'].includes(sortOrder.toLowerCase())) {
      errors.push({
        field: 'sortOrder',
        message: "sortOrder must be 'asc' or 'desc'",
      });
    }
  }

  if (errors.length > 0) {
    logger.warn(`Query validation failed: ${JSON.stringify(errors)}`);
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors,
    });
  }

  next();
};
