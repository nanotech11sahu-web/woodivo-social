import { Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { SeoData } from '../parser/interfaces/seo-fields.interface';
import { AiGenerationException } from '../shared/exceptions/app.exceptions';
import { SocialContentResponseDto } from './dto/social-content-response.dto';
import {
  AI_PROVIDER,
  AIProvider,
  GeneratedSocialContent,
} from './interfaces/ai-provider.interface';
import { PromptBuilder } from './prompt/prompt-builder';

/**
 * Single entry point the rest of the application uses for AI content
 * generation. Wraps whichever AIProvider is bound to AI_PROVIDER, builds the
 * prompt, strictly validates the JSON response, and retries on malformed
 * output up to `groq.maxJsonRetries` (config name kept generic per-provider
 * retry budget, not Groq-specific behavior).
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly promptBuilder: PromptBuilder,
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AiService.name);
  }

  async generateSocialContent(seo: SeoData): Promise<GeneratedSocialContent> {
    const prompt = this.promptBuilder.buildSocialContentPrompt(seo);
    const maxAttempts = this.appConfig.groq.maxJsonRetries;

    let lastError: Error | undefined;
    let lastRawResponse = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let rawResponse: string;
      try {
        rawResponse = await this.aiProvider.complete(prompt);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          { attempt, error: lastError.message },
          'AI provider call failed, will retry if attempts remain',
        );
        if (error instanceof AiGenerationException && !error.recoverable) {
          throw error;
        }
        continue;
      }

      lastRawResponse = rawResponse;
      const parsed = this.tryParseAndValidate(rawResponse);

      if (parsed.success) {
        this.logger.info(
          { attempt, provider: this.aiProvider.providerName },
          'AI content generated and validated successfully',
        );
        return {
          content: parsed.content,
          rawResponse,
          prompt,
          attempt,
          provider: this.aiProvider.providerName,
          model: this.aiProvider.modelName,
        };
      }

      lastError = parsed.error;
      this.logger.warn(
        { attempt, error: parsed.error.message },
        'AI response failed JSON validation, retrying',
      );
    }

    throw new AiGenerationException(
      `AI provider returned invalid content after ${maxAttempts} attempts: ${lastError?.message ?? 'unknown error'}`,
      true,
      { rawResponse: lastRawResponse },
    );
  }

  private tryParseAndValidate(
    rawResponse: string,
  ): { success: true; content: SocialContentResponseDto } | { success: false; error: Error } {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(rawResponse));
    } catch (error) {
      return {
        success: false,
        error: new Error(`Response is not valid JSON: ${(error as Error).message}`),
      };
    }

    const dto = plainToInstance(SocialContentResponseDto, json);
    const errors = validateSync(dto, { whitelist: true });

    if (errors.length > 0) {
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
      return { success: false, error: new Error(`Response failed schema validation: ${messages}`) };
    }

    return { success: true, content: dto };
  }

  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1] : trimmed;
  }
}
