import jwt from 'jsonwebtoken';
import logger from '../../logger.js';

const openPaths = [
  '/api/v1/docs/',
  '/api/v1/health',
  '/api/v1/about',
  '/api/v1/changelog',
  '/api/v1/version',
];

// Rutas que permiten acceso sin autenticación (GET público)
const publicGetPaths = [
  '/api/v1/beats', // Listado público
  '/api/v1/beats/search', // Búsqueda pública
  '/api/v1/beats/stats', // Estadísticas públicas
];

const verifyToken = (req, res, next) => {
  // Permitir rutas abiertas sin verificación
  if (openPaths.some((path) => req.path.startsWith(path))) {
    return next();
  }

  // Permitir GET público en rutas específicas
  if (
    req.method === 'GET' &&
    publicGetPaths.some((path) => req.path.startsWith(path))
  ) {
    // Intentar extraer info del usuario de los headers personalizados si existen
    const userId = req.headers['x-user-id'];
    const gatewayAuth = req.headers['x-gateway-authenticated'];
    const roles = req.headers['x-roles'];

    if (gatewayAuth === 'true' && userId) {
      req.user = {
        id: userId,
        'x-user-id': userId,
        roles: roles ? roles.split(',') : [],
      };
    }
    return next();
  }

  // Validar que la ruta incluya versión de API
  if (!req.path.startsWith('/api/v')) {
    return res
      .status(400)
      .json({ message: 'You must specify the API version, e.g. /api/v1/...' });
  }

  // Verificar autenticación mediante headers del gateway
  const userId = req.headers['x-user-id'];
  const gatewayAuth = req.headers['x-gateway-authenticated'];
  const roles = req.headers['x-roles'];

  if (!gatewayAuth || gatewayAuth !== 'true') {
    logger.warn(
      `Unauthenticated request to ${req.path} - Missing gateway authentication`
    );
    return res.status(401).json({
      success: false,
      message:
        'Authentication required. Request must come through the API Gateway.',
    });
  }

  if (!userId) {
    logger.warn(`Unauthenticated request to ${req.path} - Missing user ID`);
    return res.status(401).json({
      success: false,
      message: 'Missing user identification',
    });
  }

  // Construir objeto user con la información de los headers
  req.user = {
    id: userId,
    'x-user-id': userId,
    username: userId, // Usar el ID como username por defecto
    roles: roles ? roles.split(',') : [],
  };

  next();
};

export default verifyToken;
