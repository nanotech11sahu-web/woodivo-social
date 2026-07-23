import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SeoDataDto {
  @IsString()
  @IsNotEmpty({ message: 'seo.txt is missing a required "Title" field' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'seo.txt is missing a required "Description" field' })
  description!: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'seo.txt must specify at least one keyword' })
  @IsString({ each: true })
  @Type(() => String)
  keywords!: string[];

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsString()
  cta?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsArray()
  @ArrayNotEmpty({
    message: 'seo.txt must specify at least one target platform (Facebook/Instagram)',
  })
  @IsString({ each: true })
  @Type(() => String)
  platforms!: string[];

  @IsString()
  @IsNotEmpty({ message: 'seo.txt is missing a required "Language" field' })
  language!: string;

  @IsOptional()
  @IsString()
  additionalInstructions?: string;
}
