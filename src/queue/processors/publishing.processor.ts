import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LogLevel, SocialPlatform } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { FacebookService } from '../../facebook/facebook.service';
import { InstagramService } from '../../instagram/instagram.service';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { PublishingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { MediaType } from '../../shared/interfaces/media-type.enum';
import { SocialContentResponseDto } from '../../ai/dto/social-content-response.dto';
import { SeoData } from '../../parser/interfaces/seo-fields.interface';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { ArchivingProducer } from '../producers/archiving.producer';

/**
 * Stage 3: publishes the processed media (already a public Cloudinary URL -
 * no local file access needed) + AI-generated captions to every platform
 * requested in seo.txt, then posts the first comment on each.
 *
 * Main-post publishing and comment-posting are tracked and retried
 * independently: PublishingHistory marks a platform's main post as done,
 * MetaResponse rows ending in "/comments" mark its comment as done. This
 * matters because Meta sometimes accepts the post but rejects the comment
 * (e.g. missing pages_manage_engagement / instagram_manage_comments scope) -
 * without this split, a retry would see "platform already published" and
 * skip the whole block, permanently losing the comment attempt.
 */
@Processor(QUEUE_NAMES.PUBLISHING)
export class PublishingProcessor extends WorkerHost {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly instagramService: InstagramService,
    private readonly jobRepository: PublishJobRepository,
    private readonly archivingProducer: ArchivingProducer,
    private readonly failureRecorder: PipelineFailureRecorder,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(PublishingProcessor.name);
  }

  async process(job: Job<PublishingJobPayload>): Promise<void> {
    const { jobId, reference, mediaType, processedMediaUrls } = job.data;

    const record = await this.jobRepository.findById(jobId);
    if (!record?.generatedContent || !record.seoParsed) {
      throw new Error(`PublishJob ${jobId} is missing generated content or parsed SEO data`);
    }

    const content = record.generatedContent as unknown as SocialContentResponseDto;
    const seo = record.seoParsed as unknown as SeoData;
    const requestedPlatforms = new Set(seo.platforms.map((p) => p.toLowerCase()));
    const facebookCaption = this.finalizeFacebookCaption(
      content.facebookCaption,
      content.hashtags,
      seo.website,
    );
    const instagramCaption = this.finalizeInstagramCaption(
      content.instagramCaption,
      content.hashtags,
      seo.website,
    );
    const alreadyPublished = new Set(await this.jobRepository.getPublishedPlatforms(jobId));
    const alreadyCommented = new Set(await this.jobRepository.getCommentedPlatforms(jobId));

    const externalIds = new Map<SocialPlatform, string>();

    if (requestedPlatforms.has('facebook')) {
      if (!alreadyPublished.has(SocialPlatform.FACEBOOK)) {
        const externalId = await this.publishMainToFacebook(
          jobId,
          processedMediaUrls,
          mediaType,
          facebookCaption,
          record.isReel,
        );
        externalIds.set(SocialPlatform.FACEBOOK, externalId);
      } else {
        const existingId = await this.jobRepository.getExternalId(jobId, SocialPlatform.FACEBOOK);
        if (existingId) externalIds.set(SocialPlatform.FACEBOOK, existingId);
      }
    }

    if (requestedPlatforms.has('instagram')) {
      if (!alreadyPublished.has(SocialPlatform.INSTAGRAM)) {
        const externalId = await this.publishMainToInstagram(
          jobId,
          processedMediaUrls,
          mediaType,
          instagramCaption,
          content.altText,
        );
        externalIds.set(SocialPlatform.INSTAGRAM, externalId);
      } else {
        const existingId = await this.jobRepository.getExternalId(jobId, SocialPlatform.INSTAGRAM);
        if (existingId) externalIds.set(SocialPlatform.INSTAGRAM, existingId);
      }
    }

    if (content.firstComment) {
      const facebookId = externalIds.get(SocialPlatform.FACEBOOK);
      if (facebookId && !alreadyCommented.has(SocialPlatform.FACEBOOK)) {
        await this.commentOnFacebook(jobId, facebookId, content.firstComment);
      }

      const instagramId = externalIds.get(SocialPlatform.INSTAGRAM);
      if (instagramId && !alreadyCommented.has(SocialPlatform.INSTAGRAM)) {
        await this.commentOnInstagram(jobId, instagramId, content.firstComment);
      }
    }

    await this.jobRepository.addLog(
      jobId,
      LogLevel.INFO,
      'Post published to all requested platforms',
    );
    await this.archivingProducer.enqueueSuccess({ jobId, reference });
  }

  private async publishMainToFacebook(
    jobId: string,
    mediaUrls: string[],
    mediaType: MediaType,
    caption: string,
    isReel: boolean,
  ): Promise<string> {
    const useReelFlow = isReel && mediaType === MediaType.VIDEO;
    const result = useReelFlow
      ? await this.facebookService.publishReel(mediaUrls[0], caption)
      : await this.facebookService.publish(mediaUrls, mediaType, caption);
    const endpoint = useReelFlow
      ? '/video_reels'
      : mediaType === MediaType.IMAGE
        ? mediaUrls.length > 1
          ? '/feed'
          : '/photos'
        : '/videos';

    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.FACEBOOK,
      endpoint,
      requestPayload: { caption, mediaUrls },
      responsePayload: result.rawResponse,
      success: true,
      externalId: result.externalId,
    });

    await this.jobRepository.addPublishingHistory({
      jobId,
      platform: SocialPlatform.FACEBOOK,
      externalId: result.externalId,
      permalink: result.permalink,
      caption,
    });

    return result.externalId;
  }

  private async publishMainToInstagram(
    jobId: string,
    mediaUrls: string[],
    mediaType: MediaType,
    caption: string,
    altText: string,
  ): Promise<string> {
    const result = await this.instagramService.publish(mediaUrls, mediaType, caption, altText);

    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.INSTAGRAM,
      endpoint: mediaUrls.length > 1 ? '/media (carousel)' : '/media',
      requestPayload: { caption, mediaUrls },
      responsePayload: result.rawResponse,
      success: true,
      externalId: result.externalId,
    });

    await this.jobRepository.addPublishingHistory({
      jobId,
      platform: SocialPlatform.INSTAGRAM,
      externalId: result.externalId,
      permalink: result.permalink,
      caption,
    });

    return result.externalId;
  }

  /**
   * Facebook sometimes auto-linkifies a plain URL in a Page post, so the
   * literal website is worth guaranteeing here rather than just hoped for.
   */
  private finalizeFacebookCaption(caption: string, hashtags: string[], website?: string): string {
    let result = caption.trim();

    if (website && !result.toLowerCase().includes(website.toLowerCase())) {
      result += `\n\nVisit ${website}`;
    }

    if (hashtags.length > 0) {
      result += `\n\n${hashtags.join(' ')}`;
    }

    return result;
  }

  /**
   * Instagram never makes a caption URL clickable, so a raw link there is
   * dead text - strip it if the AI included one anyway and use the
   * platform-standard "link in bio" convention instead.
   */
  private finalizeInstagramCaption(caption: string, hashtags: string[], website?: string): string {
    let result = caption.trim();

    if (website) {
      const escaped = website.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`https?:\\/\\/${escaped}\\S*|${escaped}\\S*`, 'gi'), '').trim();
      result = result.replace(/\n{3,}/g, '\n\n').trim();

      if (!/link in bio/i.test(result)) {
        result += `\n\n🔗 Link in bio to shop now!`;
      }
    }

    if (hashtags.length > 0) {
      result += `\n\n${hashtags.join(' ')}`;
    }

    return result;
  }

  private async commentOnFacebook(
    jobId: string,
    externalId: string,
    message: string,
  ): Promise<void> {
    await this.facebookService.publishFirstComment(externalId, message);
    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.FACEBOOK,
      endpoint: `/${externalId}/comments`,
      requestPayload: { message },
      responsePayload: {},
      success: true,
      externalId,
    });
  }

  private async commentOnInstagram(
    jobId: string,
    externalId: string,
    message: string,
  ): Promise<void> {
    await this.instagramService.publishFirstComment(externalId, message);
    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.INSTAGRAM,
      endpoint: `/${externalId}/comments`,
      requestPayload: { message },
      responsePayload: {},
      success: true,
      externalId,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<PublishingJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'PUBLISHING', error);
  }
}
