import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { PostValidationException } from '../shared/exceptions/app.exceptions';
import { MEDIA_EXTENSIONS, SEO_FILENAME } from '../shared/constants/queue.constants';
import { FilesystemUtil } from '../shared/utils/filesystem.util';

/**
 * Validates that a post folder contains exactly what the pipeline needs
 * before any AI/media/publishing work begins: a readable seo.txt and exactly
 * one supported media file.
 */
@Injectable()
export class PostValidatorService {
  async validate(folderPath: string): Promise<void> {
    const files = await FilesystemUtil.listFiles(folderPath);

    if (!files.includes(SEO_FILENAME)) {
      throw new PostValidationException(`Missing required "${SEO_FILENAME}" file`, { folderPath });
    }

    const seoPath = path.join(folderPath, SEO_FILENAME);
    const seoText = await FilesystemUtil.readTextFile(seoPath);
    if (!seoText.trim()) {
      throw new PostValidationException(`"${SEO_FILENAME}" is empty`, { folderPath });
    }

    const imageFiles = files.filter((file) =>
      (MEDIA_EXTENSIONS.IMAGE as readonly string[]).includes(path.extname(file).toLowerCase()),
    );
    const videoFiles = files.filter((file) =>
      (MEDIA_EXTENSIONS.VIDEO as readonly string[]).includes(path.extname(file).toLowerCase()),
    );
    const mediaFiles = [...imageFiles, ...videoFiles];

    if (mediaFiles.length === 0) {
      throw new PostValidationException('No supported media file (image or video) found', {
        folderPath,
      });
    }

    if (mediaFiles.length > 1) {
      throw new PostValidationException(
        `Expected exactly one media file, found ${mediaFiles.length}: ${mediaFiles.join(', ')}`,
        { folderPath, mediaFiles },
      );
    }
  }
}
