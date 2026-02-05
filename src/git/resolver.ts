import { simpleGit } from 'simple-git';

const git = simpleGit();

export interface ResolveOptions {
  range?: string;
  staged?: boolean;
  last?: number;
  since?: string;
}

export interface ResolvedRange {
  type: 'staged' | 'range';
  from?: string;
  to?: string;
  display: string;
}

/**
 * Resolves user input into a concrete git revision range
 *
 * | User Input        | Resolved Range                    |
 * |-------------------|-----------------------------------|
 * | --staged          | Diff of staged index vs HEAD      |
 * | HEAD~3..HEAD      | Passed through directly           |
 * | abc123            | abc123~1..abc123                  |
 * | --last 3          | HEAD~3..HEAD                      |
 * | --since yesterday | $(git log --since=... | tail)..HEAD |
 */
export async function resolve(options: ResolveOptions): Promise<ResolvedRange> {
  // Staged mode - diff of index vs HEAD
  if (options.staged) {
    return {
      type: 'staged',
      display: 'staged changes',
    };
  }

  // --last N commits
  if (options.last !== undefined) {
    return {
      type: 'range',
      from: `HEAD~${options.last}`,
      to: 'HEAD',
      display: `last ${options.last} commits`,
    };
  }

  // --since date
  if (options.since) {
    const logs = await git.log({ '--since': options.since });
    if (logs.all.length === 0) {
      throw new Error(`No commits found since ${options.since}`);
    }
    const oldestCommit = logs.all[logs.all.length - 1];
    if (!oldestCommit) {
      throw new Error(`No commits found since ${options.since}`);
    }
    return {
      type: 'range',
      from: `${oldestCommit.hash}~1`,
      to: 'HEAD',
      display: `commits since ${options.since}`,
    };
  }

  // Explicit range provided
  if (options.range) {
    // Check if it's a range (contains ..)
    if (options.range.includes('..')) {
      const [from, to] = options.range.split('..');
      return {
        type: 'range',
        from,
        to: to || 'HEAD',
        display: options.range,
      };
    }

    // Single commit - convert to range
    return {
      type: 'range',
      from: `${options.range}~1`,
      to: options.range,
      display: `commit ${options.range.substring(0, 7)}`,
    };
  }

  // Default: review the last commit
  return {
    type: 'range',
    from: 'HEAD~1',
    to: 'HEAD',
    display: 'last commit',
  };
}
