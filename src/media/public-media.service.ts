import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AppConfigService } from '../config/app-config.service';
import { FilesystemUtil } from '../shared/utils/filesystem.util';

/**
 * Temporarily exposes a processed media file at a public URL so the
 * Instagram Graph API (which requires image_url/video_url, not direct binary
 * upload) can fetch it. Files are namespaced by jobId and cleaned up once
 * publishing completes.
 */
@Injectable()
export class PublicMediaService {
  constructor(private readonly appConfig: AppConfigService) {}

  async expose(jobId: string, filePath: string): Promise<string> {
    const destDir = path.join(this.appConfig.publicMedia.dir, jobId);
    await FilesystemUtil.ensureDir(destDir);
    const destPath = path.join(destDir, path.basename(filePath));
    await fs.copyFile(filePath, destPath);
    return `${this.appConfig.publicMedia.baseUrl}/${jobId}/${encodeURIComponent(path.basename(filePath))}`;
  }

  async cleanup(jobId: string): Promise<void> {
    const jobDir = path.join(this.appConfig.publicMedia.dir, jobId);
    if (await FilesystemUtil.pathExists(jobDir)) {
      await fs.rm(jobDir, { recursive: true, force: true });
    }
  }

  get servedDirectory(): string {
    return this.appConfig.publicMedia.dir;
  }
}
