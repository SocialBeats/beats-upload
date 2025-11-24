import express from 'express';
import { BeatController } from '../controllers/beatController.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Beat:
 *       type: object
 *       required:
 *         - title
 *         - artist
 *         - genre
 *         - bpm
 *         - duration
 *         - audio
 *       properties:
 *         _id:
 *           type: string
 *           description: ID único del beat
 *         title:
 *           type: string
 *           maxLength: 100
 *           description: Título del beat
 *         artist:
 *           type: string
 *           maxLength: 50
 *           description: Nombre del artista
 *         genre:
 *           type: string
 *           enum: [Hip Hop, Trap, R&B, Pop, Rock, Electronic, Jazz, Reggaeton, Other]
 *           description: Género musical
 *         bpm:
 *           type: number
 *           minimum: 60
 *           maximum: 200
 *           description: Beats por minuto
 *         duration:
 *           type: number
 *           minimum: 10
 *           description: Duración en segundos
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Etiquetas del beat
 *         audio:
 *           type: object
 *           properties:
 *             url:
 *               type: string
 *               description: URL del archivo de audio
 *             filename:
 *               type: string
 *               description: Nombre del archivo
 *             size:
 *               type: number
 *               description: Tamaño del archivo en bytes
 *             format:
 *               type: string
 *               enum: [mp3, wav, flac, aac]
 *         pricing:
 *           type: object
 *           properties:
 *             isFree:
 *               type: boolean
 *             price:
 *               type: number
 *         stats:
 *           type: object
 *           properties:
 *             plays:
 *               type: number
 *             downloads:
 *               type: number
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     BeatInput:
 *       type: object
 *       required:
 *         - title
 *         - artist
 *         - genre
 *         - bpm
 *         - duration
 *         - audio
 *       properties:
 *         title:
 *           type: string
 *           maxLength: 100
 *           example: "Summer Vibes"
 *         artist:
 *           type: string
 *           maxLength: 50
 *           example: "DJ Producer"
 *         genre:
 *           type: string
 *           enum: [Hip Hop, Trap, R&B, Pop, Rock, Electronic, Jazz, Reggaeton, Other]
 *           example: "Hip Hop"
 *         bpm:
 *           type: number
 *           minimum: 60
 *           maximum: 200
 *           example: 120
 *         duration:
 *           type: number
 *           minimum: 10
 *           example: 180
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["chill", "summer", "trap"]
 *         description:
 *           type: string
 *           maxLength: 500
 *           example: "A chill summer beat perfect for relaxing"
 *         audio:
 *           type: object
 *           required:
 *             - url
 *             - filename
 *             - size
 *             - format
 *           properties:
 *             url:
 *               type: string
 *               example: "https://storage.example.com/beats/summer-vibes.mp3"
 *             filename:
 *               type: string
 *               example: "summer-vibes.mp3"
 *             size:
 *               type: number
 *               example: 5242880
 *             format:
 *               type: string
 *               enum: [mp3, wav, flac, aac]
 *               example: "mp3"
 */

/**
 * @swagger
 * /api/v1/beats:
 *   post:
 *     tags:
 *       - Beats
 *     summary: Crear un nuevo beat
 *     description: Crea un nuevo beat en la plataforma
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BeatInput'
 *     responses:
 *       201:
 *         description: Beat creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Beat created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Beat'
 *       400:
 *         description: Error de validación
 *       500:
 *         description: Error interno del servidor
 */
router.post('/', BeatController.createBeat);

/**
 * @swagger
 * /api/v1/beats:
 *   get:
 *     tags:
 *       - Beats
 *     summary: Obtener todos los beats
 *     description: Obtiene una lista paginada de beats con filtros opcionales
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Cantidad de elementos por página
 *       - in: query
 *         name: genre
 *         schema:
 *           type: string
 *         description: Filtrar por género
 *       - in: query
 *         name: artist
 *         schema:
 *           type: string
 *         description: Filtrar por artista
 *       - in: query
 *         name: minBpm
 *         schema:
 *           type: integer
 *         description: BPM mínimo
 *       - in: query
 *         name: maxBpm
 *         schema:
 *           type: integer
 *         description: BPM máximo
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Filtrar por tags (separados por coma)
 *       - in: query
 *         name: isFree
 *         schema:
 *           type: boolean
 *         description: Filtrar beats gratuitos/pagos
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *         description: Campo para ordenar
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Orden de clasificación
 *     responses:
 *       200:
 *         description: Lista de beats obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Beats retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Beat'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalBeats:
 *                       type: integer
 *                     hasNext:
 *                       type: boolean
 *                     hasPrev:
 *                       type: boolean
 */
router.get('/', BeatController.getAllBeats);

/**
 * @swagger
 * /api/v1/beats/search:
 *   get:
 *     tags:
 *       - Beats
 *     summary: Buscar beats
 *     description: Busca beats por título, artista, tags o descripción
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Término de búsqueda
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Cantidad de resultados por página
 *     responses:
 *       200:
 *         description: Búsqueda realizada exitosamente
 *       400:
 *         description: Término de búsqueda inválido
 */
router.get('/search', BeatController.searchBeats);

/**
 * @swagger
 * /api/v1/beats/stats:
 *   get:
 *     tags:
 *       - Beats
 *     summary: Obtener estadísticas
 *     description: Obtiene estadísticas generales de los beats
 *     responses:
 *       200:
 *         description: Estadísticas obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     general:
 *                       type: object
 *                       properties:
 *                         totalBeats:
 *                           type: number
 *                         totalPlays:
 *                           type: number
 *                         totalDownloads:
 *                           type: number
 *                         avgDuration:
 *                           type: number
 *                     genres:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           count:
 *                             type: number
 */
router.get('/stats', BeatController.getStats);

/**
 * @swagger
 * /api/v1/beats/{id}:
 *   get:
 *     tags:
 *       - Beats
 *     summary: Obtener un beat por ID
 *     description: Obtiene los detalles de un beat específico
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del beat
 *     responses:
 *       200:
 *         description: Beat obtenido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Beat retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Beat'
 *       404:
 *         description: Beat no encontrado
 *       400:
 *         description: ID de beat inválido
 */
router.get('/:id', BeatController.getBeatById);

/**
 * @swagger
 * /api/v1/beats/{id}:
 *   put:
 *     tags:
 *       - Beats
 *     summary: Actualizar un beat
 *     description: Actualiza los datos de un beat existente
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del beat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BeatInput'
 *     responses:
 *       200:
 *         description: Beat actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Beat updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Beat'
 *       404:
 *         description: Beat no encontrado
 *       400:
 *         description: Error de validación
 */
router.put('/:id', BeatController.updateBeat);

/**
 * @swagger
 * /api/v1/beats/{id}:
 *   delete:
 *     tags:
 *       - Beats
 *     summary: Eliminar un beat
 *     description: Elimina un beat permanentemente de la base de datos.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del beat
 *     responses:
 *       200:
 *         description: Beat eliminado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Beat deleted successfully"
 *       404:
 *         description: Beat no encontrado
 *       400:
 *         description: ID de beat inválido
 */
router.delete('/:id', BeatController.deleteBeat);

/**
 * @swagger
 * /api/v1/beats/{id}/play:
 *   post:
 *     tags:
 *       - Beats
 *     summary: Reproducir beat
 *     description: Incrementa el contador de reproducciones del beat
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del beat
 *     responses:
 *       200:
 *         description: Contador de reproducciones actualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Play count updated"
 *                 data:
 *                   type: object
 *                   properties:
 *                     beatId:
 *                       type: string
 *                     plays:
 *                       type: number
 *       404:
 *         description: Beat no encontrado
 */
router.post('/:id/play', BeatController.playBeat);

export default router;
