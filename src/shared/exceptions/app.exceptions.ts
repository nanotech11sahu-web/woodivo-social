/**
 * Base class for all domain errors raised by the publishing pipeline.
 * `recoverable` tells the queue processors whether a retry makes sense.
 */
export abstract class AppException extends Error {
  protected constructor(
    message: string,
    public readonly recoverable: boolean,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace(this, new.target);
  }
}

/** Raised when a pending post folder fails structural validation (missing/invalid files). */
export class PostValidationException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, false, context);
  }
}

/** Raised when seo.txt cannot be parsed into the expected structure. */
export class SeoParseException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, false, context);
  }
}

/** Raised by an AIProvider implementation when generation fails or returns invalid JSON. */
export class AiGenerationException extends AppException {
  constructor(message: string, recoverable = true, context?: Record<string, unknown>) {
    super(message, recoverable, context);
  }
}

/** Raised by Sharp/FFmpeg pipelines on invalid or unprocessable media. */
export class MediaProcessingException extends AppException {
  constructor(message: string, recoverable = true, context?: Record<string, unknown>) {
    super(message, recoverable, context);
  }
}

/** Raised when the Meta Graph API rejects a publish request. */
export class MetaPublishException extends AppException {
  constructor(
    message: string,
    recoverable = true,
    public readonly statusCode?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, recoverable, context);
  }
}

/** Raised when moving/archiving a post folder fails. */
export class ArchiveException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, false, context);
  }
}

/** Raised when a queue stage has exhausted all configured retries. */
export class RetryExhaustedException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, false, context);
  }
}
