import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ConfigError,
  GitError,
  McpReviewError,
  ToolServerError,
  formatErrorForUser,
  isRetryableError,
} from '../src/errors.js';

describe('McpReviewError', () => {
  it('sets name, code, and message', () => {
    const err = new McpReviewError('something broke', 'TEST_CODE');
    expect(err.name).toBe('McpReviewError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something broke');
    expect(err.cause).toBeUndefined();
  });

  it('stores the cause error', () => {
    const cause = new Error('root cause');
    const err = new McpReviewError('wrapper', 'WRAP', cause);
    expect(err.cause).toBe(cause);
  });

  it('is an instance of Error', () => {
    const err = new McpReviewError('test', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpReviewError);
  });
});

describe('ToolServerError', () => {
  it('sets correct name, code, serverName, and message', () => {
    const err = new ToolServerError('git-diff', 'server crashed');
    expect(err.name).toBe('ToolServerError');
    expect(err.code).toBe('TOOL_SERVER_ERROR');
    expect(err.serverName).toBe('git-diff');
    expect(err.message).toBe('server crashed');
    expect(err.cause).toBeUndefined();
  });

  it('stores the cause error', () => {
    const cause = new Error('spawn failed');
    const err = new ToolServerError('file-context', 'failed to start', cause);
    expect(err.cause).toBe(cause);
  });

  it('is an instance of McpReviewError and Error', () => {
    const err = new ToolServerError('test-server', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpReviewError);
    expect(err).toBeInstanceOf(ToolServerError);
  });
});

describe('ApiError', () => {
  it('sets correct name, code, message, statusCode, and retryable', () => {
    const err = new ApiError('rate limited', 429, true);
    expect(err.name).toBe('ApiError');
    expect(err.code).toBe('API_ERROR');
    expect(err.message).toBe('rate limited');
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
  });

  it('defaults retryable to false', () => {
    const err = new ApiError('bad request', 400);
    expect(err.retryable).toBe(false);
  });

  it('handles undefined statusCode', () => {
    const err = new ApiError('network failure');
    expect(err.statusCode).toBeUndefined();
    expect(err.retryable).toBe(false);
  });

  it('stores the cause error', () => {
    const cause = new Error('fetch failed');
    const err = new ApiError('api down', 500, true, cause);
    expect(err.cause).toBe(cause);
  });

  it('is an instance of McpReviewError and Error', () => {
    const err = new ApiError('test', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpReviewError);
    expect(err).toBeInstanceOf(ApiError);
  });
});

describe('GitError', () => {
  it('sets correct name, code, and message', () => {
    const err = new GitError('not a git repository');
    expect(err.name).toBe('GitError');
    expect(err.code).toBe('GIT_ERROR');
    expect(err.message).toBe('not a git repository');
    expect(err.cause).toBeUndefined();
  });

  it('stores the cause error', () => {
    const cause = new Error('exec failed');
    const err = new GitError('git diff failed', cause);
    expect(err.cause).toBe(cause);
  });

  it('is an instance of McpReviewError and Error', () => {
    const err = new GitError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpReviewError);
    expect(err).toBeInstanceOf(GitError);
  });
});

describe('ConfigError', () => {
  it('sets correct name, code, and message', () => {
    const err = new ConfigError('invalid model name');
    expect(err.name).toBe('ConfigError');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.message).toBe('invalid model name');
    expect(err.cause).toBeUndefined();
  });

  it('stores the cause error', () => {
    const cause = new Error('YAML parse error');
    const err = new ConfigError('failed to load config', cause);
    expect(err.cause).toBe(cause);
  });

  it('is an instance of McpReviewError and Error', () => {
    const err = new ConfigError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(McpReviewError);
    expect(err).toBeInstanceOf(ConfigError);
  });
});

describe('isRetryableError', () => {
  it('returns true for ApiError with retryable=true', () => {
    const err = new ApiError('rate limited', 429, true);
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns false for ApiError with retryable=false', () => {
    const err = new ApiError('bad request', 400, false);
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns true for network error with ECONNRESET code', () => {
    const err = new Error('connection reset');
    (err as Error & { code: string }).code = 'ECONNRESET';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for network error with ECONNREFUSED code', () => {
    const err = new Error('connection refused');
    (err as Error & { code: string }).code = 'ECONNREFUSED';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for network error with ETIMEDOUT code', () => {
    const err = new Error('timed out');
    (err as Error & { code: string }).code = 'ETIMEDOUT';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for network error with ENOTFOUND code', () => {
    const err = new Error('not found');
    (err as Error & { code: string }).code = 'ENOTFOUND';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for network error with EAI_AGAIN code', () => {
    const err = new Error('dns lookup');
    (err as Error & { code: string }).code = 'EAI_AGAIN';
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for error with "network" in message', () => {
    const err = new Error('network error occurred');
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for error with "socket hang up" in message', () => {
    const err = new Error('socket hang up');
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns false for non-retryable McpReviewError', () => {
    const err = new GitError('not a repo');
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for generic Error without network indicators', () => {
    const err = new Error('something failed');
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('formatErrorForUser', () => {
  it('formats ToolServerError with server name', () => {
    const err = new ToolServerError('git-diff', 'process exited');
    expect(formatErrorForUser(err)).toBe('Tool server "git-diff" error: process exited');
  });

  it('formats ApiError with status code', () => {
    const err = new ApiError('unauthorized', 401);
    expect(formatErrorForUser(err)).toBe('API error: unauthorized (HTTP 401)');
  });

  it('formats ApiError with retryable hint', () => {
    const err = new ApiError('rate limited', 429, true);
    expect(formatErrorForUser(err)).toBe(
      'API error: rate limited (HTTP 429) — this error may be resolved by retrying',
    );
  });

  it('formats ApiError without status code', () => {
    const err = new ApiError('connection failed');
    expect(formatErrorForUser(err)).toBe('API error: connection failed');
  });

  it('formats GitError', () => {
    const err = new GitError('not a git repository');
    expect(formatErrorForUser(err)).toBe('Git error: not a git repository');
  });

  it('formats ConfigError', () => {
    const err = new ConfigError('invalid model name');
    expect(formatErrorForUser(err)).toBe('Configuration error: invalid model name');
  });

  it('formats base McpReviewError with code', () => {
    const err = new McpReviewError('something happened', 'CUSTOM_CODE');
    expect(formatErrorForUser(err)).toBe('Error [CUSTOM_CODE]: something happened');
  });

  it('formats generic Error', () => {
    const err = new Error('generic failure');
    expect(formatErrorForUser(err)).toBe('Unexpected error: generic failure');
  });

  it('formats non-Error values', () => {
    expect(formatErrorForUser('string error')).toBe('Unexpected error: string error');
    expect(formatErrorForUser(42)).toBe('Unexpected error: 42');
    expect(formatErrorForUser(null)).toBe('Unexpected error: null');
  });
});
