export class McpReviewError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'McpReviewError';
  }
}

export class ToolServerError extends McpReviewError {
  constructor(
    public readonly serverName: string,
    message: string,
    cause?: Error,
  ) {
    super(message, 'TOOL_SERVER_ERROR', cause);
    this.name = 'ToolServerError';
  }
}

export class ApiError extends McpReviewError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    cause?: Error,
  ) {
    super(message, 'API_ERROR', cause);
    this.name = 'ApiError';
  }
}

export class GitError extends McpReviewError {
  constructor(message: string, cause?: Error) {
    super(message, 'GIT_ERROR', cause);
    this.name = 'GitError';
  }
}

export class ConfigError extends McpReviewError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigError';
  }
}

/**
 * Checks whether an error is retryable.
 * An error is retryable if it is an ApiError with retryable=true,
 * or if it is a network-related error (based on common error codes/messages).
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.retryable;
  }

  if (error instanceof Error) {
    const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code && networkCodes.includes(errorWithCode.code)) {
      return true;
    }

    const networkPatterns = ['network', 'socket hang up', 'ECONNRESET', 'ETIMEDOUT'];
    const messageLower = error.message.toLowerCase();
    for (const pattern of networkPatterns) {
      if (messageLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Produces a clean, user-friendly error message without stack traces.
 * Handles all McpReviewError subclasses plus generic errors.
 */
export function formatErrorForUser(error: unknown): string {
  if (error instanceof ToolServerError) {
    return `Tool server "${error.serverName}" error: ${error.message}`;
  }

  if (error instanceof ApiError) {
    const parts = [`API error: ${error.message}`];
    if (error.statusCode !== undefined) {
      parts.push(`(HTTP ${error.statusCode})`);
    }
    if (error.retryable) {
      parts.push('— this error may be resolved by retrying');
    }
    return parts.join(' ');
  }

  if (error instanceof GitError) {
    return `Git error: ${error.message}`;
  }

  if (error instanceof ConfigError) {
    return `Configuration error: ${error.message}`;
  }

  if (error instanceof McpReviewError) {
    return `Error [${error.code}]: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Unexpected error: ${error.message}`;
  }

  return `Unexpected error: ${String(error)}`;
}
