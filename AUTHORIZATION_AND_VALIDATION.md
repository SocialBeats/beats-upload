# Sistema de Autorización y Validación - Beats Upload Microservice

## 📋 Resumen

Este microservicio implementa un sistema completo de **autenticación**, **autorización** y **validación** siguiendo las mejores prácticas de arquitectura de microservicios.

## 🏗️ Arquitectura de Microservicios

### Información del Usuario Desnormalizada

En una arquitectura de microservicios, **no duplicamos toda la entidad Usuario**. En su lugar, almacenamos solo la información mínima necesaria:

```javascript
createdBy: {
  userId: "507f1f77bcf86cd799439011",      // ID del usuario (referencia al microservicio de Auth)
  username: "john_doe",                     // Nombre para mostrar (evita llamadas al otro servicio)
  roles: ["user", "producer"]               // Roles para validaciones rápidas
}
```

**Ventajas:**

- ✅ No hay dependencia directa del microservicio de usuarios
- ✅ Consultas rápidas sin llamadas HTTP entre servicios
- ✅ Resiliente a caídas del servicio de autenticación
- ✅ Información suficiente para autorización básica

## 🔐 Sistema de Autenticación

### JWT Token Structure

El token JWT viene del microservicio de autenticación con esta estructura:

```javascript
{
  "id": "507f1f77bcf86cd799439011",
  "x-user-id": "john_doe",
  "roles": ["user", "producer"],
  "x-gateway-authenticated": "true",
  "iat": 1672531200,
  "exp": 1672617600
}
```

### Middleware de Autenticación (`authMiddlewares.js`)

**Rutas Abiertas (sin token):**

- `GET /api/v1/health`
- `GET /api/v1/docs/`
- `GET /api/v1/about`
- `GET /api/v1/beats` (listado público)
- `GET /api/v1/beats/search`
- `GET /api/v1/beats/stats`

**Rutas Protegidas (requieren token):**

- `POST /api/v1/beats` - Crear beat
- `PUT /api/v1/beats/:id` - Actualizar beat
- `DELETE /api/v1/beats/:id` - Eliminar beat
- `POST /api/v1/beats/upload-url` - Generar URL de carga

## 🛡️ Sistema de Autorización

### Middlewares de Autorización (`authorizationMiddleware.js`)

#### 1. `requireAuth`

Verifica que el usuario esté autenticado.

```javascript
router.post('/beats', requireAuth, createBeat);
```

**Responde con 401** si no hay token válido.

---

#### 2. `requireOwnership`

Verifica que el usuario sea el **propietario del beat** o un **administrador**.

```javascript
router.put('/beats/:id', requireAuth, requireOwnership, updateBeat);
```

**Lógica:**

- ✅ Permite si `beat.createdBy.userId === req.user.id`
- ✅ Permite si el usuario tiene rol `admin` o `x-roles`
- ❌ Devuelve 403 si no cumple ninguna condición

**Optimización:** Adjunta el beat cargado a `req.beat` para evitar consultarlo de nuevo en el controller.

---

#### 3. `requireBeatAccess`

Controla el acceso a **beats privados**.

```javascript
router.get('/beats/:id', requireBeatAccess, getBeatById);
```

**Lógica:**

- ✅ Si el beat es **público** (`isPublic: true`), permite acceso a todos
- ✅ Si el beat es **privado**, solo permite:
  - El propietario (`createdBy.userId === req.user.id`)
  - Administradores (`roles` contiene `admin`)
- ❌ Devuelve 401 si es privado y no hay autenticación
- ❌ Devuelve 403 si es privado y el usuario no tiene permiso

---

#### 4. `optionalAuth`

Para rutas que funcionan con o sin autenticación (ej: GET público que muestra más datos si estás logueado).

```javascript
router.get('/beats/:id/details', optionalAuth, getBeatDetails);
```

## ✅ Sistema de Validación

### Middlewares de Validación (`validationMiddleware.js`)

#### 1. `validateCreateBeat`

Valida todos los campos requeridos al **crear un beat**.

**Campos validados:**

- `title` (requerido, max 100 caracteres)
- `artist` (requerido, max 50 caracteres)
- `genre` (requerido, enum válido)
- `bpm` (requerido, 60-200)
- `duration` (requerido, mínimo 10 segundos)
- `audio.s3Key`, `audio.filename`, `audio.size`, `audio.format` (requeridos)
- `key` (opcional, enum válido)
- `tags` (opcional, array, máximo 10)
- `description` (opcional, max 500 caracteres)
- `pricing` (valida coherencia: si no es gratis, debe tener precio > 0)

**Ejemplo de error:**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "title", "message": "Title is required" },
    { "field": "bpm", "message": "BPM must be a number between 60 and 200" }
  ]
}
```

---

#### 2. `validateUpdateBeat`

Similar a `validateCreateBeat`, pero todos los campos son **opcionales** (solo valida los que están presentes).

**Además:**

- ❌ **Previene actualización de campos sensibles**: `_id`, `createdAt`, `createdBy`, `stats`

---

#### 3. `validateQueryParams`

Valida parámetros de consulta para GET requests.

**Validaciones:**

- `page` (entero positivo)
- `limit` (1-50)
- `minBpm`, `maxBpm` (rango válido)
- `sortBy` (campo válido: `createdAt`, `title`, `artist`, `bpm`, `stats.plays`, `pricing.price`)
- `sortOrder` (`asc` o `desc`)

## 🔄 Flujo de Request Completo

### Ejemplo: Actualizar un Beat

```
1. Request: PUT /api/v1/beats/123abc
   Headers: Authorization: Bearer <token>
   Body: { "title": "New Title", "bpm": 120 }

2. authMiddlewares.js (verifyToken)
   ✓ Extrae el token
   ✓ Verifica con JWT_SECRET
   ✓ Adjunta req.user = { id, username, roles }

3. requireAuth
   ✓ Verifica que req.user existe

4. requireOwnership
   ✓ Busca el beat en la DB
   ✓ Verifica: beat.createdBy.userId === req.user.id
   ✓ Adjunta req.beat (para evitar consulta duplicada)

5. validateUpdateBeat
   ✓ Valida que "bpm" esté entre 60-200
   ✓ Valida que "title" no exceda 100 caracteres
   ✓ Previene actualización de campos sensibles

6. BeatController.updateBeat
   ✓ Usa req.beat (ya cargado)
   ✓ Actualiza solo los campos permitidos
   ✓ Devuelve el beat actualizado

7. Response: 200 OK
   { "success": true, "message": "Beat updated successfully", "data": {...} }
```

## 🚨 Casos de Error

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Authentication required. Please log in."
}
```

**Cuándo:** No hay token o el token es inválido.

---

### 403 Forbidden

```json
{
  "success": false,
  "message": "You do not have permission to modify this beat"
}
```

**Cuándo:** El usuario está autenticado, pero no es el propietario ni administrador.

---

### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "bpm", "message": "BPM must be a number between 60 and 200" }
  ]
}
```

**Cuándo:** Los datos enviados no cumplen las validaciones.

---

### 404 Not Found

```json
{
  "success": false,
  "message": "Beat not found"
}
```

**Cuándo:** El ID del beat no existe en la base de datos.

## 🧪 Testing con Postman/Insomnia

### 1. Crear Beat (autenticado)

```http
POST /api/v1/beats
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Sunset Vibes",
  "artist": "John Producer",
  "genre": "Trap",
  "bpm": 140,
  "duration": 180,
  "audio": {
    "s3Key": "users/john/sunset-vibes.mp3",
    "filename": "sunset-vibes.mp3",
    "size": 4500000,
    "format": "mp3"
  },
  "tags": ["trap", "summer", "chill"],
  "isPublic": false
}
```

### 2. Obtener Beat Público (sin auth)

```http
GET /api/v1/beats/123abc
```

### 3. Obtener Beat Privado (con auth)

```http
GET /api/v1/beats/456def
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Actualizar Beat (solo propietario)

```http
PUT /api/v1/beats/123abc
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Sunset Vibes (Remix)",
  "bpm": 145
}
```

### 5. Eliminar Beat (solo propietario)

```http
DELETE /api/v1/beats/123abc
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 📝 Notas Importantes

1. **JWT Secret:** Debe estar configurado en `.env` como `JWT_SECRET`
2. **Roles de Admin:** Se detectan por la presencia de `"x-roles"` o `"admin"` en el array `roles` del token
3. **Beats Privados:** Por defecto, `isPublic: true`. Para crear beats privados, establecer `isPublic: false`
4. **Logs:** Todos los intentos de acceso no autorizados se registran con `logger.warn()`

## 🔧 Configuración

### Variables de Entorno Requeridas

```env
JWT_SECRET=tu_secreto_super_seguro_aqui
NODE_ENV=production
```

### Actualizar Información del Usuario

Si el microservicio de autenticación actualiza el username/roles del usuario, **no se refleja automáticamente** en los beats existentes (por diseño de desnormalización).

Si necesitas sincronizar, deberías:

1. Crear un endpoint interno `/internal/update-user`
2. Llamarlo desde el microservicio de Auth cuando un usuario actualice su perfil
3. Actualizar todos los beats con `Beat.updateMany({ "createdBy.userId": userId }, { $set: { "createdBy.username": newUsername } })`

---

## 📚 Referencias

- [JWT.io](https://jwt.io/) - Para debuggear tokens
- [Express Middleware](https://expressjs.com/en/guide/using-middleware.html)
- [Mongoose Validation](https://mongoosejs.com/docs/validation.html)
