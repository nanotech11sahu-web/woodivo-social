import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MEDIA_EXTENSIONS, SEO_FILENAME } from '../shared/constants/queue.constants';
import { FilesystemUtil } from '../shared/utils/filesystem.util';
import { PostMetaUtil } from '../shared/utils/post-meta.util';
import { PublishJobRepository } from '../queue/publish-job.repository';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CreatePostDto } from './dto/create-post.dto';
import { QueryPostsDto } from './dto/query-posts.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { toPostSummary, toPostDetail } from './post-response.mapper';

const SUPPORTED_EXTENSIONS = [...MEDIA_EXTENSIONS.IMAGE, ...MEDIA_EXTENSIONS.VIDEO];

/**
 * HTTP hand-off for post creation. Exists so Woodivo's backend can submit a
 * finished post (media + seo.txt content) to this app over the network when
 * the two are deployed as separate services and can't share a filesystem.
 * Writes into this app's OWN pending/ folder - the scheduler then picks it
 * up exactly as if it had appeared there directly, no pipeline changes needed.
 */
@Controller('posts')
export class IngestController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly jobRepository: PublishJobRepository,
    private readonly schedulerService: SchedulerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IngestController.name);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(FileInterceptor('media'))
  async create(
    @Body() dto: CreatePostDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ folderName: string; status: string }> {
    if (!file) {
      throw new BadRequestException('Multipart field "media" (image or video file) is required');
    }

    const extension = path.extname(file.originalname).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])) {
      throw new BadRequestException(
        `Unsupported media file extension "${extension}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      );
    }

    const folderName = `post-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const folderPath = path.join(this.appConfig.socialPosts.pendingDir, folderName);

    await FilesystemUtil.ensureDir(folderPath);
    await fs.writeFile(path.join(folderPath, SEO_FILENAME), dto.seo, 'utf-8');
    await fs.writeFile(path.join(folderPath, `media${extension}`), file.buffer);
    await PostMetaUtil.write(folderPath, {
      sourceType: dto.sourceType ?? 'OTHER',
      sourceId: dto.sourceId,
      sourceTitle: dto.sourceTitle,
      urgent: dto.urgent ?? false,
    });

    this.logger.info(
      {
        folderName,
        originalFilename: file.originalname,
        sourceType: dto.sourceType ?? 'OTHER',
        urgent: dto.urgent ?? false,
      },
      'Post received via ingest API',
    );

    return { folderName, status: 'queued' };
  }

  /**
   * Processes pending folders right now instead of waiting for the next
   * scheduled slot - called by Woodivo right after submitting an urgent
   * ("Post Now") post so it doesn't sit until the next 10am/1pm/5pm/8pm run.
   */
  @Post('trigger-now')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  async triggerNow() {
    return this.schedulerService.triggerNow();
  }

  /** Paginated status listing - powers Woodivo's CMS "Social Posts" table. */
  @Get()
  @UseGuards(ApiKeyGuard)
  async findAll(@Query() query: QueryPostsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.jobRepository.listJobs(page, limit);

    return {
      items: items.map(toPostSummary),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Get(':id')
  @UseGuards(ApiKeyGuard)
  async findOne(@Param('id') id: string) {
    const job = await this.jobRepository.findByIdWithHistory(id);
    if (!job) {
      throw new NotFoundException(`No post found with id "${id}"`);
    }
    return toPostDetail(job);
  }
}
