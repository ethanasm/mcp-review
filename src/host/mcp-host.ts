import type { Config } from '../config.js';
import type { ResolvedRange } from '../git/resolver.js';
import type { ReviewResult } from '../reviewer.js';
import { ConversationManager } from './conversation.js';
import { ToolRegistry } from './tool-registry.js';

export interface MCPHostOptions extends Config {
  verbose?: boolean;
}

/**
 * MCP Host Runtime
 *
 * Manages the lifecycle of MCP tool servers and orchestrates
 * the review conversation with the LLM.
 *
 * Responsibilities:
 * - Spawn and manage tool server processes via stdio transport
 * - Perform capability negotiation with each server on startup
 * - Maintain a tool registry mapping tool names to their servers
 * - Forward tool call requests from the LLM to the appropriate server
 * - Collect tool results and feed them back into the LLM conversation
 * - Handle timeouts, retries, and graceful shutdown
 */
export class MCPHost {
  private toolRegistry: ToolRegistry;
  private conversation: ConversationManager;
  private initialized = false;

  constructor(options: MCPHostOptions) {
    this.toolRegistry = new ToolRegistry();
    this.conversation = new ConversationManager(options);
  }

  /**
   * Initialize the MCP host and start tool servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // TODO: Start MCP tool servers
    // - Git Diff Tool
    // - File Context Tool
    // - Convention Scanner Tool
    // - Related Files Tool

    await this.toolRegistry.initialize();
    this.initialized = true;
  }

  /**
   * Run a review for the given range
   */
  async runReview(range: ResolvedRange): Promise<ReviewResult> {
    if (!this.initialized) {
      throw new Error('MCPHost not initialized. Call initialize() first.');
    }

    // TODO: Implement full review flow
    // 1. Get diff for range using git-diff tool
    // 2. Construct initial prompt with diff
    // 3. Send to Claude API with available tool descriptions
    // 4. Handle tool calls in a loop until LLM produces final output
    // 5. Parse and return structured review result

    return this.conversation.runReview(range, this.toolRegistry);
  }

  /**
   * Shutdown all tool servers gracefully
   */
  async shutdown(): Promise<void> {
    await this.toolRegistry.shutdown();
    this.initialized = false;
  }
}
