export interface AppConfig {
  nodeEnv: string;
  port: number;
  appName: string;
}

export interface SchedulerConfig {
  cronExpression: string;
  enabled: boolean;
  timezone: string;
}

export interface QueueRetryConfig {
  maxRetries: number;
  backoffMs: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
}

export interface MetaConfig {
  graphApiBaseUrl: string;
  graphApiVersion: string;
  appId?: string;
  appSecret?: string;
  pageId?: string;
  pageAccessToken?: string;
  igBusinessAccountId?: string;
  requestTimeoutMs: number;
  webhookVerifyToken?: string;
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface GroqConfig {
  apiBaseUrl: string;
  apiKey?: string;
  model: string;
  requestTimeoutMs: number;
  maxJsonRetries: number;
}

export interface MediaConfig {
  imageMaxWidth: number;
  imageMaxHeight: number;
  imageJpegQuality: number;
  imageMaxSizeBytes: number;
  videoMaxDurationSec: number;
  videoMaxSizeBytes: number;
  videoTargetBitrateKbps: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  processingTimeoutMs: number;
}

export interface MailConfig {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to?: string;
}

export interface LoggerConfig {
  level: string;
  pretty: boolean;
}

export interface IngestConfig {
  apiKey: string;
  maxUploadBytes: number;
}

export interface WoodivoConfiguration {
  app: AppConfig;
  scheduler: SchedulerConfig;
  queueRetry: QueueRetryConfig;
  redis: RedisConfig;
  meta: MetaConfig;
  cloudinary: CloudinaryConfig;
  groq: GroqConfig;
  media: MediaConfig;
  mail: MailConfig;
  logger: LoggerConfig;
  ingest: IngestConfig;
}

export default (): WoodivoConfiguration => {
  return {
    app: {
      nodeEnv: process.env.NODE_ENV ?? 'development',
      port: parseInt(process.env.PORT ?? '3000', 10),
      appName: process.env.APP_NAME ?? 'woodivo-social-publisher',
    },
    scheduler: {
      cronExpression: process.env.SCHEDULER_CRON_EXPRESSION ?? '*/30 * * * * *',
      enabled: (process.env.SCHEDULER_ENABLED ?? 'true') === 'true',
      timezone: process.env.SCHEDULER_TIMEZONE ?? 'UTC',
    },
    queueRetry: {
      maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES ?? '3', 10),
      backoffMs: parseInt(process.env.QUEUE_RETRY_BACKOFF_MS ?? '5000', 10),
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB ?? '0', 10),
      tls: (process.env.REDIS_TLS ?? 'false') === 'true',
    },
    meta: {
      graphApiBaseUrl: process.env.META_GRAPH_API_BASE_URL ?? 'https://graph.facebook.com',
      graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
      appId: process.env.META_APP_ID || undefined,
      appSecret: process.env.META_APP_SECRET || undefined,
      pageId: process.env.META_PAGE_ID || undefined,
      pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || undefined,
      igBusinessAccountId: process.env.META_IG_BUSINESS_ACCOUNT_ID || undefined,
      requestTimeoutMs: parseInt(process.env.META_REQUEST_TIMEOUT_MS ?? '30000', 10),
      webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || undefined,
    },
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
      apiKey: process.env.CLOUDINARY_API_KEY ?? '',
      apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    },
    groq: {
      apiBaseUrl: process.env.GROQ_API_BASE_URL ?? 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY || undefined,
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      requestTimeoutMs: parseInt(process.env.GROQ_REQUEST_TIMEOUT_MS ?? '45000', 10),
      maxJsonRetries: parseInt(process.env.GROQ_MAX_JSON_RETRIES ?? '3', 10),
    },
    media: {
      imageMaxWidth: parseInt(process.env.IMAGE_MAX_WIDTH ?? '1440', 10),
      imageMaxHeight: parseInt(process.env.IMAGE_MAX_HEIGHT ?? '1800', 10),
      imageJpegQuality: parseInt(process.env.IMAGE_JPEG_QUALITY ?? '82', 10),
      imageMaxSizeBytes: parseInt(process.env.IMAGE_MAX_SIZE_BYTES ?? '8388608', 10),
      videoMaxDurationSec: parseInt(process.env.VIDEO_MAX_DURATION_SEC ?? '180', 10),
      videoMaxSizeBytes: parseInt(process.env.VIDEO_MAX_SIZE_BYTES ?? '104857600', 10),
      videoTargetBitrateKbps: parseInt(process.env.VIDEO_TARGET_BITRATE_KBPS ?? '3500', 10),
      ffmpegPath: process.env.FFMPEG_PATH || undefined,
      ffprobePath: process.env.FFPROBE_PATH || undefined,
      processingTimeoutMs: parseInt(process.env.MEDIA_PROCESSING_TIMEOUT_MS ?? '300000', 10),
    },
    mail: {
      host: process.env.SMTP_HOST || undefined,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
      user: process.env.SMTP_USER || undefined,
      pass: process.env.SMTP_PASS || undefined,
      from: process.env.MAIL_FROM ?? 'alerts@woodivo.local',
      to: process.env.MAIL_TO || undefined,
    },
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: (process.env.LOG_PRETTY ?? 'true') === 'true',
    },
    ingest: {
      apiKey: process.env.INGEST_API_KEY ?? '',
      maxUploadBytes: parseInt(process.env.INGEST_MAX_UPLOAD_BYTES ?? '157286400', 10),
    },
  };
};
