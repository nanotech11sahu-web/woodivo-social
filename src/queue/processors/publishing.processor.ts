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
    const { jobId, reference, mediaType, processedMediaUrl } = job.data;

    const record = await this.jobRepository.findById(jobId);
    if (!record?.generatedContent || !record.seoParsed) {
      throw new Error(`PublishJob ${jobId} is missing generated content or parsed SEO data`);
    }

    const content = record.generatedContent as unknown as SocialContentResponseDto;
    const seo = record.seoParsed as unknown as SeoData;
    const requestedPlatforms = new Set(seo.platforms.map((p) => p.toLowerCase()));
    const facebookCaption = this.finalizeCaption(
      content.facebookCaption,
      content.hashtags,
      seo.website,
    );
    const instagramCaption = this.finalizeCaption(
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
          processedMediaUrl,
          mediaType,
          facebookCaption,
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
          processedMediaUrl,
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
    mediaUrl: string,
    mediaType: MediaType,
    caption: string,
  ): Promise<string> {
    const result = await this.facebookService.publish(mediaUrl, mediaType, caption);

    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.FACEBOOK,
      endpoint: mediaType === MediaType.IMAGE ? '/photos' : '/videos',
      requestPayload: { caption, mediaUrl },
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
    mediaUrl: string,
    mediaType: MediaType,
    caption: string,
    altText: string,
  ): Promise<string> {
    const result = await this.instagramService.publish(mediaUrl, mediaType, caption, altText);

    await this.jobRepository.addMetaResponse({
      jobId,
      platform: SocialPlatform.INSTAGRAM,
      endpoint: '/media',
      requestPayload: { caption, mediaUrl },
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
   * The prompt deliberately keeps hashtags out of the AI-written caption
   * (so the prose reads cleanly) and doesn't force a literal website
   * mention - both are guaranteed here instead of just hoped for, since a
   * missing hashtag block or missing link is a real, visible defect on a
   * live public post, not a cosmetic one.
   */
  private finalizeCaption(caption: string, hashtags: string[], website?: string): string {
    let result = caption.trim();

    if (website && !result.toLowerCase().includes(website.toLowerCase())) {
      result += `\n\nVisit ${website}`;
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
