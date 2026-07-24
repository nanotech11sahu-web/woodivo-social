import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class CloudinaryHealthIndicator {
  constructor(private readonly appConfig: AppConfigService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      cloudinary.config({
        cloud_name: this.appConfig.cloudinary.cloudName,
        api_key: this.appConfig.cloudinary.apiKey,
        api_secret: this.appConfig.cloudinary.apiSecret,
        secure: true,
      });
      await cloudinary.api.ping();
      return { [key]: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('Cloudinary check failed', {
        [key]: { status: 'down', message: (error as Error).message },
      });
    }
  }
}
