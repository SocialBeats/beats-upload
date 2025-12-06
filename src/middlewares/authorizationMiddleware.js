import logger from '../../logger.js';
import Beat from '../models/Beat.js';

/**
 * Middleware para verificar que el usuario está autenticado
 * Debe usarse DESPUÉS de verifyToken
 */
export const requireAuth = (req, res, next) => {
  if (!req.user || !req.user.id) {
    logger.warn(`Unauthorized access attempt to ${req.path}`);
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.',
    });
  }
  next();
};

/**
 * Middleware para verificar que el usuario es el propietario del recurso
 * Debe usarse en rutas que modifiquen beats específicos
 */
export const requireOwnership = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Buscar el beat
    const beat = await Beat.findById(id);

    if (!beat) {
      return res.status(404).json({
        success: false,
        message: 'Beat not found',
      });
    }

    // Verificar si el usuario es el creador
    const isOwner = beat.createdBy?.userId === userId;

    // Verificar si el usuario es admin (basado en roles del JWT)
    const isAdmin = req.user.roles?.includes('admin');

    if (!isOwner && !isAdmin) {
      logger.warn(
        `User ${userId} attempted to modify beat ${id} without permission`
      );
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify this beat',
      });
    }

    // Adjuntar el beat al request para evitar buscarlo de nuevo en el controller
    req.beat = beat;
    next();
  } catch (error) {
    logger.error(`Error in requireOwnership middleware: ${error.message}`);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid beat ID format',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error verifying ownership',
    });
  }
};

/**
 * Middleware para verificar acceso a beats privados
 * Permite acceso si:
 * - El beat es público
 * - El usuario es el propietario
 * - El usuario es admin
 */
export const requireBeatAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const beat = await Beat.findById(id);

    if (!beat) {
      return res.status(404).json({
        success: false,
        message: 'Beat not found',
      });
    }

    // Si el beat es público, permitir acceso
    if (beat.isPublic) {
      req.beat = beat;
      return next();
    }

    // Si el beat es privado, verificar autenticación
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'This beat is private. Authentication required.',
      });
    }

    // Verificar si es el propietario o admin
    const isOwner = beat.createdBy?.userId === userId;
    const isAdmin = req.user.roles?.includes('admin');

    if (!isOwner && !isAdmin) {
      logger.warn(
        `User ${userId} attempted to access private beat ${id} without permission`
      );
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this private beat',
      });
    }

    req.beat = beat;
    next();
  } catch (error) {
    logger.error(`Error in requireBeatAccess middleware: ${error.message}`);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid beat ID format',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error verifying beat access',
    });
  }
};

/**
 * Middleware opcional de autenticación
 * Intenta autenticar, pero permite continuar si no hay token
 * Útil para rutas que funcionan con o sin autenticación
 */
export const optionalAuth = (req, res, next) => {
  // Si hay usuario del verifyToken, ya está autenticado
  if (req.user) {
    return next();
  }

  // Si no hay usuario, continuar sin error
  next();
};
