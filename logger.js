import { createLogger, format, transports } from 'winston';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ quiet: true, path: path.join(__dirname, '.env') });

const logLevel = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
const isProduction = process.env.NODE_ENV === 'production';

const levelColors = {
  info: '\x1b[34m', // Blue
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  debug: '\x1b[32m', // Green
  verbose: '\x1b[38;2;161;74;189m', // Purple
  silly: '\x1b[35m', // Magenta
};

const resetColor = '\x1b[0m';

// Custom format for development (human readable)
const devFormat = format.printf(
  ({ level, message, timestamp, ...metadata }) => {
    const color = levelColors[level] || '';
    let msg = `${new Date(timestamp).toLocaleString()} [${color}${level.toUpperCase()}${resetColor}]: ${message}`;

    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  }
);

// JSON format for production (structured logging)
const prodFormat = format.combine(format.timestamp(), format.json());

const logger = createLogger({
  level: logLevel,
  format: isProduction
    ? prodFormat
    : format.combine(format.timestamp(), devFormat),
  transports: [new transports.Console({ level: logLevel })],
});

export default logger;
