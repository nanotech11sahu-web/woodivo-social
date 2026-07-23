import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import * as path from 'path';
import { Job } from 'bullmq';
import { LogLevel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { AiService } from '../../ai/ai.service';
import { ParserService } from '../../parser/parser.service';
import {
  MEDIA_EXTENSIONS,
  SEO_FILENAME,
  QUEUE_NAMES,
} from '../../shared/constants/queue.constants';
import { AiGenerationJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { MediaType } from '../../shared/interfaces/media-type.enum';
import { FilesystemUtil } from '../../shared/utils/filesystem.util';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { MediaProcessingProducer } from '../producers/media-processing.producer';

/**
 * Stage 1: parses seo.txt and calls AiService.generateSocialContent(), then
 * advances the pipeline by enqueueing the media-processing job.
 */
@Processor(QUEUE_NAMES.AI_GENERATION)
export class AiGenerationProcessor extends WorkerHost {
  constructor(
    private readonly parserService: ParserService,
    private readonly aiService: AiService,
    private readonly jobRepository: PublishJobRepository,
    private readonly mediaProcessingProducer: MediaProcessingProducer,
    private readonly failureRecorder: PipelineFailureRecorder,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(AiGenerationProcessor.name);
  }

  async process(job: Job<AiGenerationJobPayload>): Promise<void> {
    const { jobId, folderPath } = job.data;

    const seoFilePath = path.join(folderPath, SEO_FILENAME);
    const seo = await this.parserService.parseSeoFile(seoFilePath);
    await this.jobRepository.setSeoParsed(jobId, seo);

    const generated = await this.aiService.generateSocialContent(seo);

    await this.jobRepository.addAiResponse({
      jobId,
      provider: generated.provider,
      model: generated.model,
      prompt: generated.prompt,
      rawResponse: generated.rawResponse,
      parsedResponse: generated.content as unknown as Record<string, unknown>,
      isValid: true,
      attempt: generated.attempt,
    });

    await this.jobRepository.setGeneratedContent(jobId, generated.content);
    await this.jobRepository.addLog(jobId, LogLevel.INFO, 'AI content generated successfully');

    const files = await FilesystemUtil.listFiles(folderPath);
    const imageFile = FilesystemUtil.findFileByExtensions(files, MEDIA_EXTENSIONS.IMAGE);
    const videoFile = FilesystemUtil.findFileByExtensions(files, MEDIA_EXTENSIONS.VIDEO);
    const mediaFile = imageFile ?? videoFile;
    const mediaType = imageFile ? MediaType.IMAGE : MediaType.VIDEO;

    if (!mediaFile) {
      throw new Error('No media file (image or video) found in post folder during AI stage');
    }

    const mediaPath = path.join(folderPath, mediaFile);
    await this.jobRepository.setMediaInfo(jobId, mediaType, mediaPath);

    await this.mediaProcessingProducer.enqueue({
      jobId,
      folderName: job.data.folderName,
      folderPath,
      mediaType,
      mediaPath,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiGenerationJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'AI_GENERATION', error);
  }
}
