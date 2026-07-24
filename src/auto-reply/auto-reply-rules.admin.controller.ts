import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../ingest/guards/api-key.guard';
import { AutoReplyRuleRepository } from './auto-reply-rule.repository';
import { CreateAutoReplyRuleDto } from './dto/create-auto-reply-rule.dto';
import { UpdateAutoReplyRuleDto } from './dto/update-auto-reply-rule.dto';

/**
 * CRUD for keyword auto-reply rules, managed from Woodivo's CMS (proxied
 * there through backend/src/modules/auto-reply-rules). Guarded by the same
 * shared-secret ApiKeyGuard used for the ingest endpoints.
 */
@Controller('admin/auto-reply-rules')
@UseGuards(ApiKeyGuard)
export class AutoReplyRulesAdminController {
  constructor(private readonly ruleRepository: AutoReplyRuleRepository) {}

  @Get()
  findAll() {
    return this.ruleRepository.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const rule = await this.ruleRepository.findById(id);
    if (!rule) throw new NotFoundException(`No auto-reply rule found with id "${id}"`);
    return rule;
  }

  @Post()
  create(@Body() dto: CreateAutoReplyRuleDto) {
    return this.ruleRepository.create({
      platform: dto.platform ?? ('BOTH' as never),
      trigger: dto.trigger,
      keywords: dto.keywords,
      active: dto.active,
      priority: dto.priority,
      replyComment: dto.replyComment,
      replyDm: dto.replyDm,
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAutoReplyRuleDto) {
    const existing = await this.ruleRepository.findById(id);
    if (!existing) throw new NotFoundException(`No auto-reply rule found with id "${id}"`);
    return this.ruleRepository.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.ruleRepository.findById(id);
    if (!existing) throw new NotFoundException(`No auto-reply rule found with id "${id}"`);
    await this.ruleRepository.remove(id);
    return { deleted: true };
  }
}
