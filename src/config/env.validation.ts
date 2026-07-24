import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  APP_NAME: Joi.string().default('woodivo-social-publisher'),

  SCHEDULER_CRON_EXPRESSION: Joi.string().default('*/30 * * * * *'),
  SCHEDULER_ENABLED: Joi.boolean().default(true),
  SCHEDULER_TIMEZONE: Joi.string().default('UTC'),

  QUEUE_MAX_RETRIES: Joi.number().integer().min(0).default(3),
  QUEUE_RETRY_BACKOFF_MS: Joi.number().integer().min(0).default(5000),

  DATABASE_URL: Joi.string().uri().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),
  REDIS_TLS: Joi.boolean().default(false),

  META_GRAPH_API_BASE_URL: Joi.string().uri().default('https://graph.facebook.com'),
  META_GRAPH_API_VERSION: Joi.string().default('v21.0'),
  META_APP_ID: Joi.string().allow('').optional(),
  META_APP_SECRET: Joi.string().allow('').optional(),
  META_PAGE_ID: Joi.string().allow('').optional(),
  META_PAGE_ACCESS_TOKEN: Joi.string().allow('').optional(),
  META_IG_BUSINESS_ACCOUNT_ID: Joi.string().allow('').optional(),
  META_REQUEST_TIMEOUT_MS: Joi.number().default(30000),

  // Media (original + processed) is stored in Cloudinary rather than local
  // disk, so job state survives restarts/redeploys between submission and
  // the scheduled processing slot - see CloudinaryService.
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  GROQ_API_BASE_URL: Joi.string().uri().default('https://api.groq.com/openai/v1'),
  GROQ_API_KEY: Joi.string().allow('').optional(),
  GROQ_MODEL: Joi.string().default('llama-3.3-70b-versatile'),
  GROQ_REQUEST_TIMEOUT_MS: Joi.number().default(45000),
  GROQ_MAX_JSON_RETRIES: Joi.number().integer().min(1).default(3),

  IMAGE_MAX_WIDTH: Joi.number().default(1440),
  IMAGE_MAX_HEIGHT: Joi.number().default(1800),
  IMAGE_JPEG_QUALITY: Joi.number().min(1).max(100).default(82),
  IMAGE_MAX_SIZE_BYTES: Joi.number().default(8388608),
  VIDEO_MAX_DURATION_SEC: Joi.number().default(180),
  VIDEO_MAX_SIZE_BYTES: Joi.number().default(104857600),
  VIDEO_TARGET_BITRATE_KBPS: Joi.number().default(3500),
  FFMPEG_PATH: Joi.string().allow('').optional(),
  FFPROBE_PATH: Joi.string().allow('').optional(),
  MEDIA_PROCESSING_TIMEOUT_MS: Joi.number().default(300000),

  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('alerts@woodivo.local'),
  MAIL_TO: Joi.string().allow('').optional(),

  LOG_LEVEL: Joi.string().default('info'),
  LOG_PRETTY: Joi.boolean().default(true),

  // Protects POST /posts - the HTTP handoff Woodivo's backend uses to submit posts
  // when the two services run separately (e.g. on Render) and can't share a disk.
  INGEST_API_KEY: Joi.string().min(16).required(),
  INGEST_MAX_UPLOAD_BYTES: Joi.number().default(157286400),
});
