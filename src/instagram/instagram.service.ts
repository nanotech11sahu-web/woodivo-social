import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaType } from '../shared/interfaces/media-type.enum';
import { MetaGraphClient } from '../meta/meta-graph.client';
import { SocialPublishResult } from '../meta/interfaces/publish-result.interface';
import { MetaPublishException } from '../shared/exceptions/app.exceptions';

interface ContainerResponse {
  id: string;
}

interface ContainerStatusResponse {
  status_code: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
}

interface MediaPublishResponse {
  id: string;
}

const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_TIMEOUT_MS = 120000;

/**
 * Publishes content to an Instagram Business Account via the Meta Graph API
 * Content Publishing flow: create a media container from a public URL, poll
 * until Instagram finishes processing it, then publish the container.
 */
@Injectable()
export class InstagramService {
  constructor(
    private readonly graphClient: MetaGraphClient,
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InstagramService.name);
  }

  async publish(
    mediaPublicUrls: string[],
    mediaType: MediaType,
    caption: string,
    altText: string,
  ): Promise<SocialPublishResult> {
    const { igBusinessAccountId, pageAccessToken } = this.appConfig.meta;
    if (!igBusinessAccountId || !pageAccessToken) {
      throw new MetaPublishException(
        'META_IG_BUSINESS_ACCOUNT_ID and META_PAGE_ACCESS_TOKEN must be configured to publish to Instagram',
        false,
      );
    }

    if (mediaType === MediaType.IMAGE && mediaPublicUrls.length > 1) {
      return this.publishCarousel(
        igBusinessAccountId,
        pageAccessToken,
        mediaPublicUrls,
        caption,
      );
    }

    const mediaPublicUrl = mediaPublicUrls[0];

    const containerParams: Record<string, string | number | boolean> =
      mediaType === MediaType.IMAGE
        ? {
            image_url: mediaPublicUrl,
            caption,
            alt_text: altText,
            access_token: pageAccessToken,
          }
        : {
            media_type: 'REELS',
            video_url: mediaPublicUrl,
            caption,
            access_token: pageAccessToken,
          };

    const container = await this.graphClient.post<ContainerResponse>(
      `/${igBusinessAccountId}/media`,
      containerParams,
    );

    await this.waitForContainerReady(container.data.id, pageAccessToken);

    const publishResult = await this.graphClient.post<MediaPublishResponse>(
      `/${igBusinessAccountId}/media_publish`,
      { creation_id: container.data.id, access_token: pageAccessToken },
    );

    const permalinkResult = await this.graphClient.get<{ permalink?: string }>(
      `/${publishResult.data.id}`,
      { fields: 'permalink', access_token: pageAccessToken },
    );

    this.logger.info(
      { mediaId: publishResult.data.id },
      'Published media to Instagram Business Account',
    );

    return {
      externalId: publishResult.data.id,
      permalink: permalinkResult.data.permalink,
      rawResponse: publishResult.data as unknown as Record<string, unknown>,
    };
  }

  /**
   * Instagram carousel flow: each image becomes its own child container
   * (is_carousel_item: true, no caption), then one parent container of
   * media_type CAROUSEL references all the children and carries the caption,
   * then that parent is published exactly like a single-image post.
   */
  private async publishCarousel(
    igBusinessAccountId: string,
    pageAccessToken: string,
    mediaPublicUrls: string[],
    caption: string,
  ): Promise<SocialPublishResult> {
    const childIds = await Promise.all(
      mediaPublicUrls.map(async (url) => {
        const child = await this.graphClient.post<ContainerResponse>(
          `/${igBusinessAccountId}/media`,
          {
            image_url: url,
            is_carousel_item: true,
            access_token: pageAccessToken,
          },
        );
        await this.waitForContainerReady(child.data.id, pageAccessToken);
        return child.data.id;
      }),
    );

    const parentParams: Record<string, string> = {
      media_type: 'CAROUSEL',
      caption,
      access_token: pageAccessToken,
    };
    childIds.forEach((id, index) => {
      parentParams[`children[${index}]`] = id;
    });

    const parent = await this.graphClient.post<ContainerResponse>(
      `/${igBusinessAccountId}/media`,
      parentParams,
    );

    await this.waitForContainerReady(parent.data.id, pageAccessToken);

    const publishResult = await this.graphClient.post<MediaPublishResponse>(
      `/${igBusinessAccountId}/media_publish`,
      { creation_id: parent.data.id, access_token: pageAccessToken },
    );

    const permalinkResult = await this.graphClient.get<{ permalink?: string }>(
      `/${publishResult.data.id}`,
      { fields: 'permalink', access_token: pageAccessToken },
    );

    this.logger.info(
      { mediaId: publishResult.data.id, itemCount: mediaPublicUrls.length },
      'Published carousel to Instagram Business Account',
    );

    return {
      externalId: publishResult.data.id,
      permalink: permalinkResult.data.permalink,
      rawResponse: publishResult.data as unknown as Record<string, unknown>,
    };
  }

  async publishFirstComment(mediaId: string, message: string): Promise<void> {
    const { pageAccessToken } = this.appConfig.meta;
    if (!pageAccessToken) {
      throw new MetaPublishException(
        'META_PAGE_ACCESS_TOKEN must be configured to post a comment',
        false,
      );
    }
    await this.graphClient.post(`/${mediaId}/comments`, { message, access_token: pageAccessToken });
    this.logger.info({ mediaId }, 'Posted first comment on Instagram media');
  }

  private async waitForContainerReady(containerId: string, accessToken: string): Promise<void> {
    const deadline = Date.now() + CONTAINER_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await this.graphClient.get<ContainerStatusResponse>(`/${containerId}`, {
        fields: 'status_code',
        access_token: accessToken,
      });

      if (status.data.status_code === 'FINISHED') {
        return;
      }
      if (status.data.status_code === 'ERROR' || status.data.status_code === 'EXPIRED') {
        throw new MetaPublishException(
          `Instagram media container failed processing with status ${status.data.status_code}`,
          true,
          undefined,
          { containerId },
        );
      }

      await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
    }

    throw new MetaPublishException(
      `Instagram media container did not finish processing within ${CONTAINER_POLL_TIMEOUT_MS}ms`,
      true,
      undefined,
      { containerId },
    );
  }
}
