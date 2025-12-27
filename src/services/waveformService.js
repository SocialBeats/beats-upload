import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import logger from '../../logger.js';
import { Beat } from '../models/index.js';

// Configurar ffmpeg con el binario estático
ffmpeg.setFfmpegPath(ffmpegPath);

export class WaveformService {
  /**
   * Genera el waveform de un beat y lo guarda en la DB
   * @param {Object} beat - Documento del beat
   * @param {Object} s3Client - Cliente S3 instanciado
   */
  static async generateAndSaveWaveform(beat, s3Client) {
    const tempFile = path.join(
      os.tmpdir(),
      `audio-${beat._id}-${Date.now()}.${beat.audio.format}`
    );

    try {
      logger.info(`Starting waveform generation for beat ${beat._id}`);

      // 1. Descargar archivo de S3
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: beat.audio.s3Key,
      });

      const { Body } = await s3Client.send(command);
      await pipeline(Body, fs.createWriteStream(tempFile));

      // 2. Generar waveform usando ffmpeg
      // Extraemos audio raw PCM para analizar picos
      const peaks = await this._extractPeaks(tempFile, 150); // 150 puntos es suficiente para una vista móvil/web

      // 3. Guardar en MongoDB
      // Actualizamos directamente para no necesitar traer e hidratar todo el objeto
      await Beat.findByIdAndUpdate(beat._id, {
        $set: {
          'audio.waveform': peaks,
          'audio.isWaveformGenerated': true,
        },
      });

      logger.info(`Waveform generated successfully for beat ${beat._id}`);
    } catch (error) {
      logger.error('Error generating waveform', {
        beatId: beat._id,
        error: error.message,
      });
      // No re-lanzamos el error para no tumbar procesos batch, solo logueamos
    } finally {
      // 4. Limpieza
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        logger.error('Error cleaning up temp file', { file: tempFile });
      }
    }
  }

  /**
   * Extrae picos normalizados del audio
   * @param {string} filePath
   * @param {number} samples - Cantidad de barras/puntos deseados
   * @returns {Promise<Array<number>>}
   */
  static _extractPeaks(filePath, samples) {
    return new Promise((resolve, reject) => {
      let audioData = [];

      // Procesamos el audio para obtener raw data a una baja tasa de muestreo
      // para hacerlo muy rápido. Mono canal.
      ffmpeg(filePath)
        .audioChannels(1)
        .audioFrequency(4000) // Baja frecuencia es suficiente para picos visuales
        .format('s16le') // Raw PCM 16-bit signed little-endian
        .on('error', (err) => reject(err))
        .pipe()
        .on('data', (chunk) => {
          // Chunk es un Buffer. Convertimos a array de enteros de 16 bits
          for (let i = 0; i < chunk.length; i += 2) {
            const int16 = chunk.readInt16LE(i);
            audioData.push(Math.abs(int16)); // Solo nos interesa la amplitud absoluta
          }
        })
        .on('end', () => {
          if (audioData.length === 0) return resolve([]);

          // Algoritmo simple de downsampling por bloques
          const blockSize = Math.floor(audioData.length / samples);
          const peaks = [];

          for (let i = 0; i < samples; i++) {
            const start = i * blockSize;
            let max = 0;
            // Buscamos el máximo en cada bloque
            for (
              let j = 0;
              j < blockSize && start + j < audioData.length;
              j++
            ) {
              const val = audioData[start + j];
              if (val > max) max = val;
            }
            // Normalizar a 0-1 (32768 es max para 16-bit)
            peaks.push(Number((max / 32768).toFixed(2)));
          }

          resolve(peaks);
        });
    });
  }
}
