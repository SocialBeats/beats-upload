import { Beat } from '../models/index.js';
import logger from '../../logger.js';
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'beats-upload',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'beats-interaction-group' });
const producer = kafka.producer();

const admin = kafka.admin();

async function processEvent(event) {
  const data = event.payload;

  switch (event.type) {
    case 'USER_DELETED':
      try {
        const userId = data._id;
        logger.info(`Processing USER_DELETED for user ${userId}`);

        // Dynamic import to avoid circular dependency
        const { BeatService } = await import('./beatService.js');

        // Find all beats by this user
        const beats = await Beat.find({ 'createdBy.userId': userId });
        logger.info(`Found ${beats.length} beats to delete for user ${userId}`);

        for (const beat of beats) {
          try {
            await BeatService.deleteBeatPermanently(beat._id);
            logger.info(`Deleted beat ${beat._id} for user ${userId}`);
          } catch (err) {
            logger.error(
              `Failed to delete beat ${beat._id} for user ${userId}:`,
              err
            );
          }
        }
      } catch (error) {
        logger.error('Error processing USER_DELETED event:', error);
        throw error;
      }
      break;

    default:
      logger.warn('⚠ Unknown event detected:', event.type);
  }
}

async function sendToDLQ(event, reason) {
  try {
    await producer.send({
      topic: 'beats-interaction-dlq',
      messages: [
        {
          value: JSON.stringify({
            originalEvent: event,
            error: reason,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
    logger.warn(`Event sent to DLQ: ${event.type}, reason: ${reason}`);
  } catch (err) {
    logger.error('Failed to send event to DLQ:', err);
  }
}

export async function startKafkaConsumer() {
  const MAX_RETRIES = Number(process.env.KAFKA_CONNECTION_MAX_RETRIES || 5);
  const RETRY_DELAY = Number(process.env.KAFKA_CONNECTION_RETRY_DELAY || 5000);
  const COOLDOWN_AFTER_FAIL = Number(process.env.KAFKA_COOLDOWN || 30000);

  let attempt = 1;

  while (true) {
    try {
      logger.info(`Connecting to Kafka... (Attempt ${attempt}/${MAX_RETRIES})`);
      await consumer.connect();
      await producer.connect();
      await consumer.subscribe({ topic: 'beats-events', fromBeginning: true });
      await consumer.subscribe({ topic: 'users-events', fromBeginning: true });

      logger.info('Kafka connected & listening');

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const event = JSON.parse(message.value.toString());
            await processEvent(event);
          } catch (err) {
            logger.error(
              'Error processing message:',
              err,
              'Message:',
              message.value.toString()
            );
            await sendToDLQ(message.value.toString(), err.message);
          }
        },
      });

      attempt = 1;
      break;
    } catch (err) {
      logger.error(`Kafka connection failed: ${err.message}`);

      if (attempt >= MAX_RETRIES) {
        logger.warn(
          `Max retries reached. Cooling down for ${COOLDOWN_AFTER_FAIL / 1000}s before trying again...`
        );
        await new Promise((res) => setTimeout(res, COOLDOWN_AFTER_FAIL));
        attempt = 1;
      } else {
        attempt++;
        logger.warn(`Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((res) => setTimeout(res, RETRY_DELAY));
      }
    }
  }
}

export async function isKafkaConnected() {
  try {
    await admin.connect();
    await admin.describeCluster();
    await admin.disconnect();
    return true;
  } catch (err) {
    return false;
  }
}

export function isKafkaEnabled() {
  return process.env.ENABLE_KAFKA.toLocaleLowerCase() === 'true';
}

export { consumer, producer, processEvent };
