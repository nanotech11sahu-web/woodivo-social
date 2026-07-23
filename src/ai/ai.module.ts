import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { PromptBuilder } from './prompt/prompt-builder';
import { GroqAiProvider } from './providers/groq-ai.provider';

@Module({
  providers: [
    PromptBuilder,
    GroqAiProvider,
    {
      provide: AI_PROVIDER,
      useClass: GroqAiProvider,
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
