import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import type { Ora } from 'ora';
import type { Config } from '../config.js';
import { shouldIgnoreFile } from '../config.js';
import type { DiffStats } from '../git/commands.js';
import type { ResolvedRange } from '../git/resolver.js';
import { debug, timer } from '../logger.js';
import { getInitialPrompt, getSystemPrompt } from '../prompts/system.js';
import { getFocusInstructions } from '../prompts/templates.js';
import type { ReviewResult } from '../reviewer.js';
import { createUsageTracker } from '../usage.js';
import type { ToolRegistry } from './tool-registry.js';

/**
 * Maps internal tool names to user-friendly descriptions for spinner text.
 */
const TOOL_LABELS: Record<string, string> = {
  get_diff: 'Reading diff',
  get_diff_stats: 'Reading diff stats',
  get_commit_messages: 'Reading commit messages',
  read_file: 'Reading file',
  read_lines: 'Reading file',
  list_directory: 'Scanning directory',
  scan_lint_config: 'Checking lint config',
  find_similar_patterns: 'Finding similar patterns',
  get_project_conventions: 'Checking conventions',
  find_importers: 'Finding importers',
  find_exports: 'Finding exports',
  find_test_files: 'Finding test files',
  find_type_references: 'Finding type references',
  get_file_context: 'Reading file context',
};

/**
 * Build a human-readable spinner message for a set of tool calls.
 */
function describeToolCalls(blocks: Anthropic.ToolUseBlock[]): string {
  if (blocks.length === 0) return 'Gathering context...';

  const descriptions = blocks.map((block) => {
    const label = TOOL_LABELS[block.name] ?? block.name;
    const input = block.input as Record<string, unknown>;

    // Extract the most relevant argument for context
    const file = input.path ?? input.file ?? input.target_file;
    if (typeof file === 'string') {
      // Show just the filename, not full path
      const short = file.split('/').pop() ?? file;
      return `${label} ${chalk.dim(short)}`;
    }

    return label;
  });

  if (descriptions.length === 1) {
    return descriptions[0]!;
  }

  return `${descriptions[0]} ${chalk.dim(`(+${descriptions.length - 1} more)`)}`;
}

/**
 * Maximum number of tool-call rounds before forcing the LLM to produce a final answer.
 * After this many rounds, we stop sending tools so the model must respond with text.
 */
const MAX_TOOL_ROUNDS = 2;

/**
 * Approximate max tokens to allow for the diff portion of the prompt.
 * Leaves headroom for the system prompt (~2k), tool schemas (~3k),
 * pre-loaded file contents (~20k), focus instructions (~1k),
 * and model response (4k max_tokens).
 * Claude's context is 200k tokens; we target ~100k for the diff.
 */
const MAX_DIFF_TOKENS = 100_000;

/** Rough chars-per-token ratio for estimating token counts. */
const CHARS_PER_TOKEN = 4;

/**
 * Truncate a unified diff to fit within a token budget.
 *
 * Strategy: split by file (lines starting with "diff --git"), keep as many
 * complete per-file diffs as fit, then truncate the remainder. Always
 * preserve at least the file header lines so the model knows which files
 * changed even if the hunks are dropped.
 */
export interface TruncateResult {
  diff: string;
  omittedFiles: number;
}

export function truncateDiff(diff: string, maxTokens: number = MAX_DIFF_TOKENS): TruncateResult {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (diff.length <= maxChars) {
    return { diff, omittedFiles: 0 };
  }

  // Split into per-file sections
  const fileSections: string[] = [];
  let current = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      fileSections.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current.length > 0) {
    fileSections.push(current);
  }

  // Greedily include complete file diffs until we run out of budget
  let result = '';
  let included = 0;
  for (const section of fileSections) {
    if (result.length + section.length > maxChars && included > 0) {
      break;
    }
    result += section;
    included++;
  }

  const omitted = fileSections.length - included;
  if (omitted > 0) {
    // List the omitted files (header lines only)
    const omittedHeaders = fileSections
      .slice(included)
      .map((s) => {
        const headerLine = s.split('\n').find((l) => l.startsWith('diff --git '));
        return headerLine ?? '(unknown file)';
      })
      .join('\n');

    result += `\n\n--- DIFF TRUNCATED ---\n${omitted} additional file(s) omitted to fit within context limits:\n${omittedHeaders}\n\nUse the get_diff tool with a specific file path to review omitted files.\n`;
  }

  return { diff: result, omittedFiles: omitted };
}

export interface ConversationOptions extends Config {
  verbose?: boolean;
}

/**
 * Conversation Manager
 *
 * Manages the LLM conversation state and orchestrates the review flow.
 */
/** Max retries for rate-limit (429) errors. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff on rate-limit errors. */
const RETRY_BASE_DELAY_MS = 30_000;

export class ConversationManager {
  private options: ConversationOptions;
  private client: Anthropic;

  constructor(options: ConversationOptions) {
    this.options = options;
    this.client = new Anthropic();
  }

  /**
   * Call the Anthropic messages API with automatic retry on rate-limit errors.
   * Uses exponential backoff: 30s, 60s, 120s.
   */
  private async callWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
    spinner?: Ora,
  ): Promise<Anthropic.Message> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.client.messages.create(params);
      } catch (error) {
        const isRateLimit =
          error instanceof Anthropic.RateLimitError ||
          (error instanceof Anthropic.APIError && error.status === 429);

        if (!isRateLimit || attempt >= MAX_RETRIES) {
          throw error;
        }

        // Parse retry-after header if available, otherwise use exponential backoff
        const retryAfter =
          error instanceof Anthropic.APIError ? error.headers?.['retry-after'] : undefined;
        const delaySec = retryAfter ? Number.parseInt(retryAfter, 10) : 0;
        const delayMs = delaySec > 0 ? delaySec * 1000 : RETRY_BASE_DELAY_MS * 2 ** attempt;

        debug(
          'llm',
          `Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s`,
        );

        if (spinner) {
          spinner.text = `Rate limited — retrying in ${Math.round(delayMs / 1000)}s...`;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error('Exhausted retries');
  }

  /**
   * Build the user prompt, incorporating focus-area templates when configured.
   */
  private buildInitialPrompt(
    diff: string,
    stats: { filesChanged: number },
    fileContents?: { path: string; content: string }[],
  ): string {
    const focusAreas = this.options.focus;

    // Collect focus-area instructions (without duplicating the diff)
    if (focusAreas.length > 0) {
      const instructions = focusAreas.map(getFocusInstructions).filter(Boolean);

      if (instructions.length > 0) {
        const focusSection = instructions.join('\n\n---\n\n');
        return `Please review the following code changes with specific focus on the areas listed below.

## Diff to Review

\`\`\`diff
${diff}
\`\`\`

## Focus Areas

${focusSection}

Analyzing ${stats.filesChanged} files. Use the available tools to understand the context, then provide your structured review.`;
      }
    }

    return getInitialPrompt(diff, this.options, fileContents);
  }

  /**
   * Pre-load full contents of changed files to include in the initial prompt.
   * This eliminates the most common first tool-call round (read_file on every changed file).
   * Skips binary files, ignored files, and files over 10KB.
   */
  private async preloadFileContents(
    stats: DiffStats,
  ): Promise<{ path: string; content: string }[]> {
    const MAX_FILE_SIZE = 10_000; // chars
    const MAX_FILES = this.options.max_files;

    const filesToLoad = stats.files
      .filter((f) => !shouldIgnoreFile(f, this.options.ignore))
      .slice(0, MAX_FILES);

    const results = await Promise.allSettled(
      filesToLoad.map(async (filePath) => {
        const content = await readFile(filePath, 'utf-8');
        if (content.length > MAX_FILE_SIZE) {
          return {
            path: filePath,
            content: `${content.substring(0, MAX_FILE_SIZE)}\n... (truncated)`,
          };
        }
        return { path: filePath, content };
      }),
    );

    const loaded: { path: string; content: string }[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        loaded.push(result.value);
      }
      // Skip failed reads (deleted files, binary files, etc.)
    }

    debug('review', `Pre-loaded ${loaded.length}/${filesToLoad.length} changed files`);
    return loaded;
  }

  /**
   * Run a review conversation.
   *
   * Accepts pre-fetched diff and stats to avoid redundant git calls.
   */
  async runReview(
    _range: ResolvedRange,
    toolRegistry: ToolRegistry,
    prefetched: { diff: string; stats: DiffStats },
    spinner?: Ora,
  ): Promise<ReviewResult> {
    const tracker = createUsageTracker(this.options.model);
    const { stats } = prefetched;

    // Truncate diff if it would exceed the context window
    const truncated = truncateDiff(prefetched.diff);
    const diff = truncated.diff;
    const wasTruncated = truncated.omittedFiles > 0;

    if (wasTruncated) {
      debug(
        'review',
        `Diff truncated: ${prefetched.diff.length} → ${diff.length} chars, ${truncated.omittedFiles} file(s) omitted`,
      );
    }

    if (spinner) {
      spinner.text = `Loading ${stats.filesChanged} changed file${stats.filesChanged === 1 ? '' : 's'}...`;
    }

    // Pre-load changed file contents to include in the prompt
    // Skip pre-loading when the diff is already large to stay within limits
    let fileContents: { path: string; content: string }[] = [];
    if (!wasTruncated) {
      const endPreload = timer('review', 'preload file contents');
      fileContents = await this.preloadFileContents(stats);
      endPreload();
    } else {
      debug('review', 'Skipping file pre-load: diff was truncated to fit context window');
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
        content: this.buildInitialPrompt(diff, stats, fileContents),
      },
    ];

    // Run conversation loop
    let turnNumber = 0;

    if (spinner) {
      spinner.text = `Analyzing ${stats.filesChanged} file${stats.filesChanged === 1 ? '' : 's'} ${chalk.dim('(sending to LLM)')}`;
    }

    const endFirstCall = timer('llm', `API call #${++turnNumber}`);
    let response = await this.callWithRetry(
      {
        model: this.options.model,
        max_tokens: 4096,
        system: getSystemPrompt(this.options),
        tools,
        messages,
      },
      spinner,
    );
    endFirstCall();

    tracker.addUsage(response.usage.input_tokens, response.usage.output_tokens);
    debug(
      'llm',
      `Turn ${turnNumber}: stop_reason=${response.stop_reason}, tokens=${response.usage.input_tokens}in/${response.usage.output_tokens}out`,
    );

    // Handle tool calls in a loop (capped at MAX_TOOL_ROUNDS)
    let toolRounds = 0;
    while (response.stop_reason === 'tool_use') {
      toolRounds++;
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      // Process tool calls in parallel
      const toolUseBlocks = assistantContent.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (spinner) {
        spinner.text = describeToolCalls(toolUseBlocks);
      }

      debug(
        'tools',
        `Executing ${toolUseBlocks.length} tool call(s) in parallel: ${toolUseBlocks.map((b) => b.name).join(', ')}`,
      );
      const endToolCalls = timer('tools', `${toolUseBlocks.length} parallel tool call(s)`);

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const endTool = timer('tools', `tool: ${block.name}`);
          const result = await toolRegistry.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
          endTool();
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: result.content,
            is_error: result.isError,
          };
        }),
      );
      endToolCalls();

      messages.push({ role: 'user', content: toolResults });

      // Determine whether to allow more tool calls or force a final answer
      const atLimit = toolRounds >= MAX_TOOL_ROUNDS;

      if (spinner) {
        spinner.text = atLimit
          ? 'Writing review...'
          : `Reviewing with context... ${chalk.dim(`(round ${toolRounds}/${MAX_TOOL_ROUNDS})`)}`;
      }

      if (atLimit) {
        debug('llm', `Reached max tool rounds (${MAX_TOOL_ROUNDS}), forcing final response`);
      }

      // Continue conversation — drop tools if at limit so the model must produce text
      const endApiCall = timer('llm', `API call #${++turnNumber}`);
      response = await this.callWithRetry(
        {
          model: this.options.model,
          max_tokens: 4096,
          system: getSystemPrompt(this.options),
          ...(atLimit ? {} : { tools }),
          messages,
        },
        spinner,
      );
      endApiCall();

      tracker.addUsage(response.usage.input_tokens, response.usage.output_tokens);
      debug(
        'llm',
        `Turn ${turnNumber}: stop_reason=${response.stop_reason}, tokens=${response.usage.input_tokens}in/${response.usage.output_tokens}out`,
      );
    }

    if (spinner) {
      spinner.text = 'Parsing review output...';
    }

    debug('llm', `Conversation complete after ${turnNumber} turn(s)`);

    // Parse final response
    const textContent = response.content.find((b) => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from LLM');
    }

    const result = this.parseReviewOutput(textContent.text, stats);
    result.tokenUsage = tracker.getTotal();
    if (wasTruncated) {
      result.truncated = { omittedFiles: truncated.omittedFiles };
    }
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
