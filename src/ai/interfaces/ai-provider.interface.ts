import { SocialContentResponseDto } from '../dto/social-content-response.dto';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * Contract every AI backend must implement. The rest of the application only
 * ever depends on this interface (via AiService.generateSocialContent),
 * never on a concrete provider - swap Groq for another vendor by binding a
 * different implementation to the AI_PROVIDER token.
 */
export interface AIProvider {
  /**
   * Sends a fully-built prompt to the underlying model and returns the raw
   * text response. Callers are responsible for JSON parsing/validation.
   */
  complete(prompt: string): Promise<string>;

  readonly providerName: string;
  readonly modelName: string;
}

/** Result of a validated generation, including provenance for persistence. */
export interface GeneratedSocialContent {
  content: SocialContentResponseDto;
  rawResponse: string;
  prompt: string;
  attempt: number;
  provider: string;
  model: string;
}
