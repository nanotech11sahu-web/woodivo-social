import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PostSourceType } from '../../shared/interfaces/post-meta.interface';

export class CreatePostDto {
  /**
   * Raw seo.txt-formatted content (same "Label: value" structure documented
   * in README.md) - reuses ParserService as-is, no separate schema to maintain.
   */
  @IsString()
  @IsNotEmpty({ message: '"seo" field must contain seo.txt-formatted text' })
  seo!: string;

  /** What kind of content this came from - defaults to OTHER if omitted. */
  @IsOptional()
  @IsIn(['PRODUCT', 'BLOG', 'CUSTOM', 'OTHER'])
  sourceType?: PostSourceType;

  /** Originating id in the caller's own system (e.g. a Woodivo product/blog id). */
  @IsOptional()
  @IsString()
  sourceId?: string;

  /** Display title in the caller's own system, shown in status listings. */
  @IsOptional()
  @IsString()
  sourceTitle?: string;

  /**
   * Skip the normal wait for the next scheduled slot - picked before any
   * non-urgent post of the same sourceType, and the caller can immediately
   * follow up with POST /posts/trigger-now to process it right away.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  urgent?: boolean;

  /**
   * "Post as Reel" - CMS Custom Posts only. Requires a single video file;
   * rejected if the submission is an image or a multi-item carousel.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isReel?: boolean;
}
