import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaType } from '../shared/interfaces/media-type.enum';
import { MetaGraphClient } from '../meta/meta-graph.client';
import { SocialPublishResult } from '../meta/interfaces/publish-result.interface';
import { MetaPublishException } from '../shared/exceptions/app.exceptions';

interface FacebookPhotoResponse {
  id: string;
  post_id?: string;
}

interface FacebookVideoResponse {
  id: string;
}

interface FacebookFeedResponse {
  id: string;
}

interface FacebookReelStartResponse {
  video_id: string;
  upload_url: string;
}

interface FacebookVideoStatusResponse {
  status?: { video_status: 'processing' | 'ready' | 'error' };
}

const REEL_POLL_INTERVAL_MS = 2000;
const REEL_POLL_TIMEOUT_MS = 120000;

/**
 * Publishes content to a Facebook Page via the Meta Graph API. This is the
 * only class aware of Facebook-specific endpoint shapes. Publishes from a
 * public media URL (Cloudinary) rather than a direct binary upload, so it
 * needs no local file access - same approach as InstagramService.
 */
@Injectable()
export class FacebookService {
  constructor(
    private readonly graphClient: MetaGraphClient,
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FacebookService.name);
  }

  async publish(
    mediaUrls: string[],
    mediaType: MediaType,
    caption: string,
  ): Promise<SocialPublishResult> {
    const { pageId, pageAccessToken } = this.appConfig.meta;
    if (!pageId || !pageAccessToken) {
      throw new MetaPublishException(
        'META_PAGE_ID and META_PAGE_ACCESS_TOKEN must be configured to publish to Facebook',
        false,
      );
    }

    if (mediaType === MediaType.IMAGE && mediaUrls.length > 1) {
      return this.publishCarousel(pageId, pageAccessToken, mediaUrls, caption);
    }

    const mediaUrl = mediaUrls[0];

    if (mediaType === MediaType.IMAGE) {
      const result = await this.graphClient.post<FacebookPhotoResponse>(`/${pageId}/photos`, {
        url: mediaUrl,
        caption,
        published: true,
        access_token: pageAccessToken,
      });
      const externalId = result.data.post_id ?? result.data.id;
      this.logger.info({ externalId }, 'Published photo to Facebook Page');
      return {
        externalId,
        permalink: `https://www.facebook.com/${externalId}`,
        rawResponse: result.data as unknown as Record<string, unknown>,
      };
    }

    const result = await this.graphClient.post<FacebookVideoResponse>(`/${pageId}/videos`, {
      file_url: mediaUrl,
      description: caption,
      published: true,
      access_token: pageAccessToken,
    });
    this.logger.info({ externalId: result.data.id }, 'Published video to Facebook Page');
    return {
      externalId: result.data.id,
      permalink: `https://www.facebook.com/${result.data.id}`,
      rawResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  /**
   * Facebook Page carousels aren't a single "carousel" endpoint like
   * Instagram's - each photo is uploaded unpublished to collect an id, then
   * one /feed post attaches all of them together via attached_media.
   */
  private async publishCarousel(
    pageId: string,
    pageAccessToken: string,
    mediaUrls: string[],
    caption: string,
  ): Promise<SocialPublishResult> {
    const unpublishedPhotoIds = await Promise.all(
      mediaUrls.map(async (url) => {
        const result = await this.graphClient.post<FacebookPhotoResponse>(`/${pageId}/photos`, {
          url,
          published: false,
          access_token: pageAccessToken,
        });
        return result.data.id;
      }),
    );

    const attachedMediaParams = Object.fromEntries(
      unpublishedPhotoIds.map((id, index) => [
        `attached_media[${index}]`,
        JSON.stringify({ media_fbid: id }),
      ]),
    );

    const result = await this.graphClient.post<FacebookFeedResponse>(`/${pageId}/feed`, {
      message: caption,
      access_token: pageAccessToken,
      ...attachedMediaParams,
    });

    this.logger.info(
      { externalId: result.data.id, itemCount: mediaUrls.length },
      'Published multi-photo carousel to Facebook Page',
    );

    return {
      externalId: result.data.id,
      permalink: `https://www.facebook.com/${result.data.id}`,
      rawResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  async publishFirstComment(postId: string, message: string): Promise<void> {
    await this.replyToComment(postId, message);
    this.logger.info({ postId }, 'Posted first comment on Facebook post');
  }

  /**
   * Posts a public reply. Facebook Graph API comments and replies share the
   * same endpoint shape - POST /{id}/comments works whether {id} is a post
   * id (top-level comment) or an existing comment id (threaded reply).
   */
  async replyToComment(targetId: string, message: string): Promise<void> {
    const { pageAccessToken } = this.appConfig.meta;
    if (!pageAccessToken) {
      throw new MetaPublishException(
        'META_PAGE_ACCESS_TOKEN must be configured to post a comment',
        false,
      );
    }
    await this.graphClient.post(`/${targetId}/comments`, {
      message,
      access_token: pageAccessToken,
    });
  }

  /** Sends a private reply via the Messenger Send API - requires pages_messaging. */
  async sendDirectMessage(recipientPsid: string, message: string): Promise<void> {
    const { pageId, pageAccessToken } = this.appConfig.meta;
    if (!pageId || !pageAccessToken) {
      throw new MetaPublishException(
        'META_PAGE_ID and META_PAGE_ACCESS_TOKEN must be configured to send a DM',
        false,
      );
    }
    await this.graphClient.post(`/${pageId}/messages`, {
      recipient: JSON.stringify({ id: recipientPsid }),
      message: JSON.stringify({ text: message }),
      messaging_type: 'RESPONSE',
      access_token: pageAccessToken,
    });
    this.logger.info({ recipientPsid }, 'Sent Facebook Messenger DM');
  }

  /**
   * Publishes a Facebook Reel via the dedicated /video_reels flow (distinct
   * from the plain /videos Page-video post used by `publish()`), from a
   * hosted Cloudinary URL - same "start -> upload -> poll -> finish" shape
   * as Instagram's container polling in InstagramService.
   */
  async publishReel(videoUrl: string, caption: string): Promise<SocialPublishResult> {
    const { pageId, pageAccessToken } = this.appConfig.meta;
    if (!pageId || !pageAccessToken) {
      throw new MetaPublishException(
        'META_PAGE_ID and META_PAGE_ACCESS_TOKEN must be configured to publish a Reel',
        false,
      );
    }

    const start = await this.graphClient.post<FacebookReelStartResponse>(`/${pageId}/video_reels`, {
      upload_phase: 'start',
      access_token: pageAccessToken,
    });

    await this.graphClient.postToUploadUrl(start.data.upload_url, pageAccessToken, videoUrl);

    await this.waitForReelReady(start.data.video_id, pageAccessToken);

    const finish = await this.graphClient.post<{ success: boolean }>(`/${pageId}/video_reels`, {
      upload_phase: 'finish',
      video_id: start.data.video_id,
      video_state: 'PUBLISHED',
      description: caption,
      access_token: pageAccessToken,
    });

    this.logger.info({ videoId: start.data.video_id }, 'Published Facebook Reel');

    return {
      externalId: start.data.video_id,
      permalink: `https://www.facebook.com/reel/${start.data.video_id}`,
      rawResponse: finish.data as unknown as Record<string, unknown>,
    };
  }

  private async waitForReelReady(videoId: string, accessToken: string): Promise<void> {
    const deadline = Date.now() + REEL_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await this.graphClient.get<FacebookVideoStatusResponse>(`/${videoId}`, {
        fields: 'status',
        access_token: accessToken,
      });

      if (status.data.status?.video_status === 'ready') return;
      if (status.data.status?.video_status === 'error') {
        throw new MetaPublishException(
          `Facebook Reel upload failed processing (video_id ${videoId})`,
          true,
          undefined,
          { videoId },
        );
      }

      await new Promise((resolve) => setTimeout(resolve, REEL_POLL_INTERVAL_MS));
    }

    throw new MetaPublishException(
      `Facebook Reel did not finish processing within ${REEL_POLL_TIMEOUT_MS}ms`,
      true,
      undefined,
      { videoId },
    );
  }
}
