import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import toobusy from 'toobusy-js';
import logger from './logger.js';
import { connectDB, disconnectDB } from './src/db.js';
import {
  startKafkaConsumer,
  isKafkaEnabled,
  consumer,
  producer,
} from './src/services/kafkaConsumer.js';
// import your middlewares here
import verifyToken from './src/middlewares/authMiddlewares.js';
// import your routes here
import aboutRoutes from './src/routes/aboutRoutes.js';
import healthRoutes from './src/routes/healthRoutes.js';
import beatRoutes from './src/routes/beatRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

const PORT = process.env.PORT || 3000;

// Configure toobusy with maxLag of 100ms (consistent with user-auth service)
toobusy.maxLag(parseInt(process.env.TOOBUSY_MAX_LAG || '100', 10));

const app = express();

app.use(express.json());
app.use(cors());

// Middleware for server overload detection (global level)
app.use((req, res, next) => {
  if (toobusy()) {
    logger.warn(`Server too busy - rejecting request to ${req.path}`);
    res.set('x-retry-after', '5');
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Server is too busy, please try again later',
    });
  }
  next();
});

// add your middlewares here like this:
app.use(verifyToken);

// add your routes here like this:
aboutRoutes(app);
healthRoutes(app);
app.use('/api/v1/beats', beatRoutes);

// Export app for tests. Do not remove this line
export default app;

let server;

if (process.env.NODE_ENV !== 'test') {
  await connectDB();

  if (isKafkaEnabled()) {
    logger.warn('Kafka is enabled, trying to connect');
    await startKafkaConsumer();
  } else {
    logger.warn('Kafka is not enabled');
  }

  server = app.listen(PORT, () => {
    logger.warn(`Using log level: ${process.env.LOG_LEVEL}`);
    logger.info(`API running at http://localhost:${PORT}`);
    logger.info(`Health at http://localhost:${PORT}/api/v1/health`);
    logger.info(`API docs running at http://localhost:${PORT}/api/v1/docs/`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
  });
}

async function gracefulShutdown(signal) {
  logger.warn(`${signal} received. Starting secure shutdown...`);

  // Stop toobusy interval to prevent memory leaks
  toobusy.shutdown();
  logger.info('Toobusy shutdown completed');

  try {
    logger.warn('Disconnecting Kafka consumer...');
    await consumer.disconnect();
    logger.warn('Kafka consumer disconnected.');
    logger.warn('Disconnecting Kafka producer...');
    await producer.disconnect();
    logger.warn('Kafka producer disconnected.');
  } catch (err) {
    logger.error('Error disconnecting Kafka:', err);
  }
  if (server) {
    server.close(async () => {
      logger.info(
        'Since now new connections are not allowed. Waiting for current operations to finish...'
      );

      try {
        await disconnectDB();
        logger.info('MongoDB connection is now closed.');
      } catch (err) {
        logger.error('Error disconnecting from MongoDB:', err);
      }

      logger.info('shutting down API.');
      process.exit(0);
    });
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
