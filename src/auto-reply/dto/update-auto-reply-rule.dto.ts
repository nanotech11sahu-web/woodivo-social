import { AutoReplyPlatform, AutoReplyTrigger } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateAutoReplyRuleDto {
  @IsOptional()
  @IsEnum(AutoReplyPlatform)
  platform?: AutoReplyPlatform;

  @IsOptional()
  @IsEnum(AutoReplyTrigger)
  trigger?: AutoReplyTrigger;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  replyComment?: string;

  @IsOptional()
  @IsString()
  replyDm?: string;
}
