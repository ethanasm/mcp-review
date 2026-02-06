// Fixture repository utilities
export { createFixtureRepo, type FixtureRepo, type FixtureRepoOptions } from '../fixtures/setup.js';

// Anthropic API mock utilities
export {
  createMockAnthropicClient,
  createTextBlock,
  createToolUseBlock,
  wrapReviewJson,
  DEFAULT_REVIEW_JSON,
  type MockAnthropicOptions,
  type MockContentBlock,
  type MockMessageResponse,
  type MockTextBlock,
  type MockToolUseBlock,
  type CallHistoryEntry,
} from './mock-anthropic.js';

// Test data factories
export {
  createMockReviewResult,
  createMockFinding,
  createMockDiffStats,
  createMockConfig,
} from './mock-review-result.js';
