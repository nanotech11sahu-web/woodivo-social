import { Injectable, OnModuleInit } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

const UPLOAD_FOLDER = 'woodivo-social-publisher';

/**
 * Wraps the Cloudinary SDK for the two things this app needs: uploading
 * original/processed media and downloading a Cloudinary URL back into memory
 * for processing. Media lives here (not on local disk) from the moment a
 * post is submitted, so a container restart between submission and the
 * scheduled processing slot can never lose it - only the DB row (already
 * durable in MongoDB) and this remote copy matter.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  constructor(private readonly appConfig: AppConfigService) {}

  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.appConfig.cloudinary.cloudName,
      api_key: this.appConfig.cloudinary.apiKey,
      api_secret: this.appConfig.cloudinary.apiSecret,
      secure: true,
    });
  }

  async uploadBuffer(
    buffer: Buffer,
    resourceType: 'image' | 'video',
  ): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType, folder: UPLOAD_FOLDER },
        (error, result) => {
          if (error || !result) {
            reject(
              new MediaProcessingException(
                `Cloudinary upload failed: ${error?.message ?? 'unknown error'}`,
                true,
              ),
            );
            return;
          }
          resolve(this.toUploadResult(result));
        },
      );
      uploadStream.end(buffer);
    });
  }

  async uploadFile(
    filePath: string,
    resourceType: 'image' | 'video',
  ): Promise<CloudinaryUploadResult> {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: resourceType,
        folder: UPLOAD_FOLDER,
      });
      return this.toUploadResult(result);
    } catch (error) {
      throw new MediaProcessingException(
        `Cloudinary upload failed: ${(error as Error).message}`,
        true,
      );
    }
  }

  async downloadToBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new MediaProcessingException(
        `Failed to download media from Cloudinary (${response.status}): ${url}`,
        true,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Streams a remote file straight to disk without ever holding the whole
   * thing in a Node Buffer - the only safe way to pull down large video on a
   * memory-constrained instance. Use this instead of downloadToBuffer for
   * anything that isn't guaranteed small (i.e. video).
   */
  async downloadToFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new MediaProcessingException(
        `Failed to download media from Cloudinary (${response.status}): ${url}`,
        true,
      );
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destPath));
  }

  private toUploadResult(result: UploadApiResponse): CloudinaryUploadResult {
    return { secureUrl: result.secure_url, publicId: result.public_id };
  }
}
