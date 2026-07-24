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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MEDIA_EXTENSIONS } from '../shared/constants/queue.constants';
import { MediaType } from '../shared/interfaces/media-type.enum';
import { PublishJobRepository } from '../queue/publish-job.repository';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CreatePostDto } from './dto/create-post.dto';
import { QueryPostsDto } from './dto/query-posts.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { toPostSummary, toPostDetail } from './post-response.mapper';

const SUPPORTED_EXTENSIONS = [...MEDIA_EXTENSIONS.IMAGE, ...MEDIA_EXTENSIONS.VIDEO];
// Meta's carousel formats (Facebook attached_media, Instagram CAROUSEL) both
// cap out at 10 items - reject bulkier submissions up front instead of
// letting the publishing stage discover the limit later.
const MAX_MEDIA_ITEMS = 10;

/**
 * HTTP hand-off for post creation. Exists so Woodivo's backend can submit a
 * finished post (media + seo.txt content) to this app over the network when
 * the two are deployed as separate services and can't share a filesystem.
 *
 * Media is uploaded straight to Cloudinary and the PublishJob row is created
 * immediately with status PENDING - nothing about a submitted post depends
 * on local disk, so it survives container restarts/redeploys between now and
 * whenever the scheduler picks it up.
 */
@Controller('posts')
export class IngestController {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly jobRepository: PublishJobRepository,
    private readonly schedulerService: SchedulerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IngestController.name);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(FilesInterceptor('media', MAX_MEDIA_ITEMS))
  async create(
    @Body() dto: CreatePostDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<{ reference: string; jobId: string; status: string }> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'At least one multipart "media" field (image or video file) is required',
      );
    }

    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])) {
        throw new BadRequestException(
          `Unsupported media file extension "${extension}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
        );
      }
    }

    const mediaTypes = files.map((file) =>
      (MEDIA_EXTENSIONS.IMAGE as readonly string[]).includes(
        path.extname(file.originalname).toLowerCase(),
      )
        ? MediaType.IMAGE
        : MediaType.VIDEO,
    );

    if (files.length > 1 && mediaTypes.some((type) => type !== MediaType.IMAGE)) {
      throw new BadRequestException(
        'Multi-item posts (carousels) only support images - submit video as a single "media" file',
      );
    }

    const mediaType = mediaTypes[0];

    const uploads = await Promise.all(
      files.map((file) =>
        this.cloudinaryService.uploadBuffer(
          file.buffer,
          mediaType === MediaType.IMAGE ? 'image' : 'video',
        ),
      ),
    );

    const reference = `post-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const job = await this.jobRepository.createPending({
      reference,
      seoRawText: dto.seo,
      mediaType,
      mediaUrls: uploads.map((upload) => upload.secureUrl),
      mediaPublicIds: uploads.map((upload) => upload.publicId),
      sourceType: dto.sourceType ?? 'OTHER',
      sourceId: dto.sourceId,
      sourceTitle: dto.sourceTitle,
      urgent: dto.urgent ?? false,
    });

    this.logger.info(
      {
        jobId: job.id,
        reference,
        sourceType: dto.sourceType ?? 'OTHER',
        urgent: dto.urgent ?? false,
      },
      'Post received via ingest API',
    );

    return { reference, jobId: job.id, status: 'pending' };
  }

  /**
   * Processes pending jobs right now instead of waiting for the next
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
