import { AutoReplyPlatform, AutoReplyTrigger } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAutoReplyRuleDto {
  @IsOptional()
  @IsEnum(AutoReplyPlatform)
  platform?: AutoReplyPlatform;

  @IsEnum(AutoReplyTrigger)
  trigger!: AutoReplyTrigger;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one keyword is required' })
  @IsString({ each: true })
  keywords!: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  /** Only used when trigger = COMMENT. */
  @IsOptional()
  @IsString()
  replyComment?: string;

  /** Used when trigger = COMMENT (also send a DM) or trigger = DM (reply in-thread). */
  @IsOptional()
  @IsString()
  replyDm?: string;
}
