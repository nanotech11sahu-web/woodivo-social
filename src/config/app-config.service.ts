import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GroqConfig,
  IngestConfig,
  MailConfig,
  MediaConfig,
  MetaConfig,
  PublicMediaConfig,
  QueueRetryConfig,
  RedisConfig,
  SchedulerConfig,
  SocialPostsConfig,
  WoodivoConfiguration,
} from './configuration';

/**
 * Thin typed facade over ConfigService so consumers never touch raw env keys.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<WoodivoConfiguration, true>) {}

  get app() {
    return this.configService.get('app', { infer: true });
  }

  get socialPosts(): SocialPostsConfig {
    return this.configService.get('socialPosts', { infer: true });
  }

  get scheduler(): SchedulerConfig {
    return this.configService.get('scheduler', { infer: true });
  }

  get queueRetry(): QueueRetryConfig {
    return this.configService.get('queueRetry', { infer: true });
  }

  get redis(): RedisConfig {
    return this.configService.get('redis', { infer: true });
  }

  get meta(): MetaConfig {
    return this.configService.get('meta', { infer: true });
  }

  get publicMedia(): PublicMediaConfig {
    return this.configService.get('publicMedia', { infer: true });
  }

  get groq(): GroqConfig {
    return this.configService.get('groq', { infer: true });
  }

  get media(): MediaConfig {
    return this.configService.get('media', { infer: true });
  }

  get mail(): MailConfig {
    return this.configService.get('mail', { infer: true });
  }

  get logger() {
    return this.configService.get('logger', { infer: true });
  }

  get ingest(): IngestConfig {
    return this.configService.get('ingest', { infer: true });
  }
}
