import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { promises as fs } from 'fs';
import { AppConfigService } from '../config/app-config.service';
import { FilesystemUtil } from '../shared/utils/filesystem.util';

@Injectable()
export class SocialPostsHealthIndicator {
  constructor(private readonly appConfig: AppConfigService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const { pendingDir, processingDir, completedDir, failedDir } = this.appConfig.socialPosts;
    const dirs = [pendingDir, processingDir, completedDir, failedDir];

    try {
      for (const dir of dirs) {
        await FilesystemUtil.ensureDir(dir);
        await fs.access(dir, fs.constants.R_OK | fs.constants.W_OK);
      }
      return { [key]: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('social-posts directory check failed', {
        [key]: { status: 'down', message: (error as Error).message },
      });
    }
  }
}
