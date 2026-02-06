import { vi } from 'vitest';

/**
 * Types matching the Anthropic SDK response shapes.
 * We define local types rather than importing the SDK to avoid
 * coupling test helpers directly to the SDK version.
 */

export interface MockTextBlock {
  type: 'text';
  text: string;
}

export interface MockToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type MockContentBlock = MockTextBlock | MockToolUseBlock;

export interface MockMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: MockContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: { input_tokens: number; output_tokens: number };
}

export interface MockAnthropicOptions {
  /** Pre-configured responses returned in sequence from messages.create() */
  responses?: Array<{
    content: MockContentBlock[];
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}

export interface CallHistoryEntry {
  model: string;
  max_tokens: number;
  system: unknown;
  messages: unknown[];
  tools: unknown[];
}

/**
 * A default review result in the JSON format the ConversationManager expects.
 */
export const DEFAULT_REVIEW_JSON = JSON.stringify(
  {
    critical: [
      {
        file: 'src/debug.ts',
        line: 6,
        message: 'console.log left in production code',
        suggestion: 'Remove or replace with a proper logging framework',
      },
    ],
    suggestions: [
      {
        file: 'src/debug.ts',
        line: 3,
        message: 'TODO comment should be tracked in an issue tracker',
      },
    ],
    positive: [
      {
        file: 'src/utils.ts',
        message: 'Clean, well-typed utility functions',
      },
    ],
    confidence: 'high',
  },
  null,
  2,
);

/**
 * Create a mock Anthropic client that returns pre-configured responses.
 *
 * The mock records all calls to `messages.create()` for later assertions.
 *
 * @example
 * ```ts
 * const { client, getCallHistory } = createMockAnthropicClient({
 *   responses: [
 *     {
 *       content: [{ type: 'text', text: '```json\n{"critical":[]}\n```' }],
 *       stop_reason: 'end_turn',
 *     },
 *   ],
 * });
 *
 * // Use client in place of `new Anthropic()`
 * const response = await client.messages.create({ ... });
 * expect(getCallHistory()).toHaveLength(1);
 * ```
 *
 * @example Simulating a tool_use flow followed by a final text response:
 * ```ts
 * const { client } = createMockAnthropicClient({
 *   responses: [
 *     {
 *       content: [{
 *         type: 'tool_use',
 *         id: 'call_1',
 *         name: 'read_file',
 *         input: { path: 'src/index.ts' },
 *       }],
 *       stop_reason: 'tool_use',
 *     },
 *     {
 *       content: [{ type: 'text', text: '```json\n{"critical":[]}\n```' }],
 *       stop_reason: 'end_turn',
 *     },
 *   ],
 * });
 * ```
 */
export function createMockAnthropicClient(options: MockAnthropicOptions = {}) {
  const responses = options.responses ?? [
    {
      content: [
        {
          type: 'text' as const,
          text: `\`\`\`json\n${DEFAULT_REVIEW_JSON}\n\`\`\``,
        },
      ],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 1000, output_tokens: 500 },
    },
  ];

  let callIndex = 0;
  const callHistory: CallHistoryEntry[] = [];

  const createFn = vi.fn().mockImplementation((params: Record<string, unknown>) => {
    // Record the call
    callHistory.push({
      model: params.model as string,
      max_tokens: params.max_tokens as number,
      system: params.system,
      messages: params.messages as unknown[],
      tools: params.tools as unknown[],
    });

    // Return the next response in the sequence, or repeat the last one
    const responseIndex = Math.min(callIndex, responses.length - 1);
    const response = responses[responseIndex];
    if (!response) {
      throw new Error(
        `MockAnthropicClient: no response configured for call index ${callIndex}`,
      );
    }
    callIndex++;

    const fullResponse: MockMessageResponse = {
      id: `msg_mock_${callIndex}`,
      type: 'message',
      role: 'assistant',
      content: response.content,
      model: (params.model as string) ?? 'claude-sonnet-4-20250514',
      stop_reason: response.stop_reason,
      usage: response.usage ?? { input_tokens: 500, output_tokens: 250 },
    };

    return Promise.resolve(fullResponse);
  });

  const client = {
    messages: {
      create: createFn,
    },
  };

  return {
    /** Mock client object — use in place of `new Anthropic()` */
    client,
    /** Retrieve the full call history for assertions */
    getCallHistory: () => [...callHistory],
    /** Reset call history and response index */
    reset: () => {
      callIndex = 0;
      callHistory.length = 0;
      createFn.mockClear();
    },
  };
}

/**
 * Helper to create a tool_use content block with a unique ID.
 */
export function createToolUseBlock(
  name: string,
  input: Record<string, unknown>,
  id?: string,
): MockToolUseBlock {
  return {
    type: 'tool_use',
    id: id ?? `toolu_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    input,
  };
}

/**
 * Helper to create a text content block.
 */
export function createTextBlock(text: string): MockTextBlock {
  return {
    type: 'text',
    text,
  };
}

/**
 * Helper to wrap a review result object in the JSON code block format
 * that ConversationManager.parseReviewOutput expects.
 */
export function wrapReviewJson(reviewData: Record<string, unknown>): string {
  return `\`\`\`json\n${JSON.stringify(reviewData, null, 2)}\n\`\`\``;
}
