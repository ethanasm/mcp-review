import {
  getCommitMessages,
  getDiff,
  getDiffStats,
  getStagedDiff,
  getStagedDiffStats,
} from '../../git/commands.js';

export interface GetDiffArgs {
  range: string;
  file_path?: string;
  context_lines?: number;
}

export interface GetDiffStatsArgs {
  range: string;
}

export interface GetCommitMessagesArgs {
  range: string;
}

/**
 * Parse a git range string into from/to components.
 * Supports formats:
 * - "staged" -> signals staged mode
 * - "abc123..def456" -> from=abc123, to=def456
 * - "abc123" -> from=abc123~1, to=abc123 (single commit)
 */
function parseRange(range: string): { staged: boolean; from: string; to: string } {
  if (range === 'staged') {
    return { staged: true, from: '', to: '' };
  }

  if (range.includes('..')) {
    const [from, to] = range.split('..');
    return { staged: false, from: from ?? '', to: to ?? '' };
  }

  // Single commit: expand to parent..commit
  return { staged: false, from: `${range}~1`, to: range };
}

/**
 * Handle get_diff tool call.
 * Returns the git diff output for the given range.
 */
export async function handleGetDiff(args: GetDiffArgs): Promise<string> {
  const { staged, from, to } = parseRange(args.range);

  if (staged) {
    const diff = await getStagedDiff({ contextLines: args.context_lines });
    return diff || 'No staged changes found.';
  }

  const diff = await getDiff(from, to, {
    file: args.file_path,
    contextLines: args.context_lines,
  });
  return diff || `No diff found for range ${args.range}.`;
}

/**
 * Handle get_diff_stats tool call.
 * Returns file change summary for the given range.
 */
export async function handleGetDiffStats(args: GetDiffStatsArgs): Promise<string> {
  const { staged, from, to } = parseRange(args.range);

  const stats = staged ? await getStagedDiffStats() : await getDiffStats(from, to);

  return JSON.stringify(
    {
      filesChanged: stats.filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
      files: stats.files,
    },
    null,
    2,
  );
}

/**
 * Handle get_commit_messages tool call.
 * Returns commit messages for the given range.
 */
export async function handleGetCommitMessages(args: GetCommitMessagesArgs): Promise<string> {
  const { staged, from, to } = parseRange(args.range);

  if (staged) {
    return 'Staged mode: no commits to show (changes are not yet committed).';
  }

  const commits = await getCommitMessages(from, to);

  if (commits.length === 0) {
    return `No commits found in range ${args.range}.`;
  }

  return commits
    .map((c) => `${c.hash.substring(0, 8)} ${c.date} ${c.author}\n  ${c.message}`)
    .join('\n\n');
}
