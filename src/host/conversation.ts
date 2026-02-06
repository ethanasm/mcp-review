import Anthropic from '@anthropic-ai/sdk';
import type { Ora } from 'ora';
import type { Config } from '../config.js';
import { getDiff, getDiffStats, getStagedDiff, getStagedDiffStats } from '../git/commands.js';
import type { ResolvedRange } from '../git/resolver.js';
import { getInitialPrompt, getSystemPrompt } from '../prompts/system.js';
import {
  getPerformanceReviewPrompt,
  getSecurityReviewPrompt,
  type TemplateContext,
} from '../prompts/templates.js';
import type { ReviewResult } from '../reviewer.js';
import { createUsageTracker } from '../usage.js';
import type { ToolRegistry } from './tool-registry.js';

export interface ConversationOptions extends Config {
  verbose?: boolean;
}

/**
 * Conversation Manager
 *
 * Manages the LLM conversation state and orchestrates the review flow.
 */
export class ConversationManager {
  private options: ConversationOptions;
  private client: Anthropic;

  constructor(options: ConversationOptions) {
    this.options = options;
    this.client = new Anthropic();
  }

  /**
   * Build the user prompt, incorporating focus-area templates when configured.
   */
  private buildInitialPrompt(diff: string, stats: { filesChanged: number }): string {
    const focusAreas = this.options.focus;

    if (focusAreas.length > 0) {
      const templateContext: TemplateContext = { diff, focusAreas };
      const sections: string[] = [];

      for (const area of focusAreas) {
        if (area === 'security') {
          sections.push(getSecurityReviewPrompt(templateContext));
        } else if (area === 'performance') {
          sections.push(getPerformanceReviewPrompt(templateContext));
        }
      }

      if (sections.length > 0) {
        return sections.join('\n\n---\n\n') +
          `\n\nAnalyzing ${stats.filesChanged} files. Use the available tools to understand the context, then provide your structured review.`;
      }
    }

    return getInitialPrompt(diff, this.options);
  }

  /**
   * Run a review conversation
   */
  async runReview(range: ResolvedRange, toolRegistry: ToolRegistry, spinner?: Ora): Promise<ReviewResult> {
    const tracker = createUsageTracker(this.options.model);

    // Get diff and stats
    const [diff, stats] =
      range.type === 'staged'
        ? await Promise.all([getStagedDiff(), getStagedDiffStats()])
        : await Promise.all([
            getDiff(range.from!, range.to!),
            getDiffStats(range.from!, range.to!),
          ]);

    if (spinner) {
      spinner.text = `Analyzing ${stats.filesChanged} files...`;
    }

    // Get available tools
    const tools = toolRegistry.getAvailableTools().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    // Build initial messages using focus-aware prompt
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: this.buildInitialPrompt(diff, stats),
      },
    ];

    // Run conversation loop
    let response = await this.client.messages.create({
      model: this.options.model,
      max_tokens: 4096,
      system: getSystemPrompt(this.options),
      tools,
      messages,
    });

    tracker.addUsage(response.usage.input_tokens, response.usage.output_tokens);

    // Handle tool calls in a loop
    while (response.stop_reason === 'tool_use') {
      if (spinner) {
        spinner.text = 'Gathering context...';
      }

      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      // Process tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await toolRegistry.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result.content,
            is_error: result.isError,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });

      if (spinner) {
        spinner.text = 'Generating review...';
      }

      // Continue conversation
      response = await this.client.messages.create({
        model: this.options.model,
        max_tokens: 4096,
        system: getSystemPrompt(this.options),
        tools,
        messages,
      });

      tracker.addUsage(response.usage.input_tokens, response.usage.output_tokens);
    }

    // Parse final response
    const textContent = response.content.find((b) => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from LLM');
    }

    const result = this.parseReviewOutput(textContent.text, stats);
    result.tokenUsage = tracker.getTotal();
    return result;
  }

  /**
   * Parse the LLM's structured review output
   */
  private parseReviewOutput(
    text: string,
    stats: { filesChanged: number; insertions: number; deletions: number },
  ): ReviewResult {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          critical: parsed.critical ?? [],
          suggestions: parsed.suggestions ?? [],
          positive: parsed.positive ?? [],
          confidence: parsed.confidence ?? 'medium',
          stats,
        };
      } catch {
        // Fall through to default
      }
    }

    // Return a basic result if we couldn't parse JSON
    return {
      critical: [],
      suggestions: [
        {
          file: 'review',
          message: text.substring(0, 500),
        },
      ],
      positive: [],
      confidence: 'low',
      stats,
    };
  }
}
