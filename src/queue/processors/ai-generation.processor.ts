import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LogLevel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { AiService } from '../../ai/ai.service';
import { ParserService } from '../../parser/parser.service';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { AiGenerationJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { MediaType } from '../../shared/interfaces/media-type.enum';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { MediaProcessingProducer } from '../producers/media-processing.producer';

/**
 * Stage 1: parses the job's seo text and calls
 * AiService.generateSocialContent(), then advances the pipeline by
 * enqueueing the media-processing job. Media itself already lives in
 * Cloudinary (uploaded at submission time) - this stage only reads the DB
 * job record, no filesystem access at all.
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
    const { jobId, reference } = job.data;

    const record = await this.jobRepository.findById(jobId);
    if (!record) {
      throw new Error(`PublishJob ${jobId} not found`);
    }
    if (!record.mediaUrls || record.mediaUrls.length === 0 || !record.mediaType) {
      throw new Error(`PublishJob ${jobId} is missing media information`);
    }

    const seo = this.parserService.parseSeoText(record.seoRawText);
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

    await this.mediaProcessingProducer.enqueue({
      jobId,
      reference,
      mediaType: record.mediaType as MediaType,
      mediaUrls: record.mediaUrls,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiGenerationJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'AI_GENERATION', error);
  }
}
