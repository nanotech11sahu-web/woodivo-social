import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly appConfig: AppConfigService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const redis = new Redis({
      host: this.appConfig.redis.host,
      port: this.appConfig.redis.port,
      password: this.appConfig.redis.password,
      db: this.appConfig.redis.db,
      tls: this.appConfig.redis.tls ? {} : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected PING response: ${pong}`);
      }
      return { [key]: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('Redis check failed', {
        [key]: { status: 'down', message: (error as Error).message },
      });
    } finally {
      redis.disconnect();
    }
  }
}
