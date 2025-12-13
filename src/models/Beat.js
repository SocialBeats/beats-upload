import mongoose from 'mongoose';

const beatSchema = new mongoose.Schema(
  {
    // Información básica del beat
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },

    // Características musicales
    genre: {
      type: String,
      required: [true, 'Genre is required'],
      enum: {
        values: [
          'Hip Hop',
          'Trap',
          'R&B',
          'Pop',
          'Rock',
          'Electronic',
          'Jazz',
          'Reggaeton',
          'Other',
        ],
        message: 'Please select a valid genre',
      },
    },

    key: {
      type: String,
      enum: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
      default: null,
    },

    // Tags y metadata
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      trim: true,
    },

    // Información del archivo de audio
    audio: {
      s3Key: {
        type: String,
        required: [true, 'Audio S3 Key is required'],
      },
      s3CoverKey: {
        type: String, // Optional cover image
      },
      filename: {
        type: String,
        required: [true, 'Audio filename is required'],
      },
      size: {
        type: Number, // en bytes
        required: [true, 'Audio file size is required'],
      },
      format: {
        type: String,
        required: [true, 'Audio format is required'],
        enum: ['mp3', 'wav', 'flac', 'aac'],
      },
      quality: {
        bitrate: Number, // kbps
        sampleRate: Number, // Hz
      },
    },

    // Estadísticas de engagement
    stats: {
      plays: {
        type: Number,
        default: 0,
        min: 0,
      },
      downloads: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    isPublic: {
      type: Boolean,
      default: true,
    },

    isDownloadable: {
      type: Boolean,
      default: false,
    },

    // Información del creador (desnormalizada para microservicios)
    createdBy: {
      userId: {
        type: String, // ID del usuario del microservicio de auth
        required: false, // Opcional para beats anónimos
      },
      username: {
        type: String, // Nombre de usuario para mostrar sin hacer llamadas al otro servicio
        trim: true,
      },
      roles: [
        {
          type: String, // Roles del usuario para validaciones rápidas
        },
      ],
    },
  },
  {
    timestamps: true, // Crea automáticamente createdAt y updatedAt
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.__v;
        if (ret.audio && ret.audio.s3Key) {
          const cdnDomain = process.env.CDN_DOMAIN || '';
          const baseUrl = cdnDomain.endsWith('/')
            ? cdnDomain.slice(0, -1)
            : cdnDomain;
          const key = ret.audio.s3Key.startsWith('/')
            ? ret.audio.s3Key.slice(1)
            : ret.audio.s3Key;
          ret.audio.url = `${baseUrl}/${key}`;
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Índices para mejorar consultas
beatSchema.index({ 'createdBy.userId': 1, createdAt: -1 });
beatSchema.index({ genre: 1 });
beatSchema.index({ tags: 1 });
beatSchema.index({ 'stats.plays': -1 });
beatSchema.index({ isPublic: 1 });

// Virtual para formatear duración en mm:ss
beatSchema.virtual('formattedDuration').get(function () {
  if (!this.duration) return '0:00';
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Middleware pre-save para validaciones adicionales
beatSchema.pre('save', function (next) {
  // Limpiar tags duplicados
  this.tags = [...new Set(this.tags)];

  next();
});

// Método estático para buscar beats por filtros
beatSchema.statics.findWithFilters = function (filters = {}) {
  const query = { isPublic: true };

  if (filters.genre) query.genre = filters.genre;
  if (filters.tags) query.tags = { $in: filters.tags };

  return this.find(query).sort({ createdAt: -1 });
};

// Método de instancia para incrementar reproducciones
beatSchema.methods.incrementPlays = function () {
  this.stats.plays += 1;
  return this.save();
};

export default mongoose.model('Beat', beatSchema);
