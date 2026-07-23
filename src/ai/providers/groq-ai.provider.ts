import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { AiGenerationException } from '../../shared/exceptions/app.exceptions';
import { AIProvider } from '../interfaces/ai-provider.interface';

interface GroqChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Concrete AIProvider implementation backed by Groq's OpenAI-compatible chat
 * completions API (groq.com - fast inference for open models like Llama).
 * This is the ONLY class in the codebase aware of Groq-specific request
 * shapes - everything else talks to the AIProvider interface.
 */
@Injectable()
export class GroqAiProvider implements AIProvider {
  readonly providerName = 'groq';
  readonly modelName: string;

  private readonly client: AxiosInstance;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GroqAiProvider.name);
    this.modelName = this.appConfig.groq.model;

    if (!this.appConfig.groq.apiKey) {
      this.logger.warn('GROQ_API_KEY is not set - AI generation calls will fail until configured');
    }

    this.client = axios.create({
      baseURL: this.appConfig.groq.apiBaseUrl,
      timeout: this.appConfig.groq.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${this.appConfig.groq.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async complete(prompt: string): Promise<string> {
    try {
      const response = await this.client.post<GroqChatCompletionResponse>('/chat/completions', {
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise assistant that returns only valid, strictly-formatted JSON when asked to. Never include markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new AiGenerationException('Groq API returned an empty completion', true, {
          responseData: response.data,
        });
      }
      return content;
    } catch (error) {
      if (error instanceof AiGenerationException) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const recoverable = !status || status >= 500 || status === 429;
        throw new AiGenerationException(`Groq API request failed: ${error.message}`, recoverable, {
          status,
          data: error.response?.data,
        });
      }
      throw new AiGenerationException(
        `Unexpected error calling Groq API: ${(error as Error).message}`,
        true,
      );
    }
  }
}
