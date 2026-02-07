/**
 * Shared LLM provider interface.
 *
 * All providers (Anthropic, OpenAI-compatible) implement this interface
 * so that ConversationManager is provider-agnostic.
 */

// ─── Content block types ───────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolUseBlock;

// ─── Tool definitions ──────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ─── Request / response ────────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | ToolResultContent[];
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface LLMRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Provider interface ────────────────────────────────────────────────

export interface LLMProvider {
  /**
   * Send a chat completion request and return the normalised response.
   */
  call(request: LLMRequest): Promise<LLMResponse>;
}
