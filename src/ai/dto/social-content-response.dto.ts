import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class SocialContentResponseDto {
  @IsString()
  @IsNotEmpty()
  facebookCaption!: string;

  @IsString()
  @IsNotEmpty()
  instagramCaption!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Type(() => String)
  hashtags!: string[];

  @IsString()
  @IsNotEmpty()
  firstComment!: string;

  @IsString()
  @IsNotEmpty()
  altText!: string;

  @IsString()
  @IsNotEmpty()
  seoTitle!: string;
}
