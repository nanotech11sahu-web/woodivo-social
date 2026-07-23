import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { ArchiveException } from '../shared/exceptions/app.exceptions';
import { FilesystemUtil } from '../shared/utils/filesystem.util';

/**
 * Moves a post folder from `processing/` to its final resting place -
 * `completed/` on success or `failed/` on unrecoverable error. Collision-safe:
 * never overwrites an existing archived folder with the same name.
 */
@Injectable()
export class ArchiveService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ArchiveService.name);
  }

  async archiveCompleted(currentFolderPath: string, folderName: string): Promise<string> {
    return this.moveTo(currentFolderPath, folderName, this.appConfig.socialPosts.completedDir);
  }

  async archiveFailed(currentFolderPath: string, folderName: string): Promise<string> {
    return this.moveTo(currentFolderPath, folderName, this.appConfig.socialPosts.failedDir);
  }

  private async moveTo(
    currentFolderPath: string,
    folderName: string,
    targetDir: string,
  ): Promise<string> {
    try {
      await FilesystemUtil.ensureDir(targetDir);
      const desiredPath = path.join(targetDir, folderName);
      const finalPath = await FilesystemUtil.resolveCollisionFreePath(desiredPath);
      await FilesystemUtil.moveDirectory(currentFolderPath, finalPath);
      this.logger.info({ from: currentFolderPath, to: finalPath }, 'Archived post folder');
      return finalPath;
    } catch (error) {
      throw new ArchiveException(
        `Failed to archive folder "${folderName}" to ${targetDir}: ${(error as Error).message}`,
        { currentFolderPath, targetDir },
      );
    }
  }
}
