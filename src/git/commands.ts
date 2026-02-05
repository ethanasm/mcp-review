import { type SimpleGit, simpleGit } from 'simple-git';

const git: SimpleGit = simpleGit();

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface BlameInfo {
  line: number;
  hash: string;
  author: string;
  date: string;
  content: string;
}

/**
 * Get the diff for a revision range
 */
export async function getDiff(
  from: string,
  to: string,
  options: { file?: string; contextLines?: number } = {},
): Promise<string> {
  const args = [from, to];

  if (options.contextLines !== undefined) {
    args.unshift(`-U${options.contextLines}`);
  }

  if (options.file) {
    args.push('--', options.file);
  }

  return git.diff(args);
}

/**
 * Get diff for staged changes
 */
export async function getStagedDiff(options: { contextLines?: number } = {}): Promise<string> {
  const args = ['--cached'];

  if (options.contextLines !== undefined) {
    args.unshift(`-U${options.contextLines}`);
  }

  return git.diff(args);
}

/**
 * Get diff statistics
 */
export async function getDiffStats(from: string, to: string): Promise<DiffStats> {
  const diffSummary = await git.diffSummary([from, to]);

  return {
    filesChanged: diffSummary.files.length,
    insertions: diffSummary.insertions,
    deletions: diffSummary.deletions,
    files: diffSummary.files.map((f) => f.file),
  };
}

/**
 * Get staged diff statistics
 */
export async function getStagedDiffStats(): Promise<DiffStats> {
  const diffSummary = await git.diffSummary(['--cached']);

  return {
    filesChanged: diffSummary.files.length,
    insertions: diffSummary.insertions,
    deletions: diffSummary.deletions,
    files: diffSummary.files.map((f) => f.file),
  };
}

/**
 * Get commit messages in a range
 */
export async function getCommitMessages(from: string, to: string): Promise<CommitInfo[]> {
  const logs = await git.log({ from, to });

  return logs.all.map((commit) => ({
    hash: commit.hash,
    message: commit.message,
    author: commit.author_name,
    date: commit.date,
  }));
}

/**
 * Get git blame for specific lines
 */
export async function getBlame(
  file: string,
  startLine: number,
  endLine: number,
): Promise<BlameInfo[]> {
  const result = await git.raw(['blame', '-L', `${startLine},${endLine}`, '--porcelain', file]);

  // Parse porcelain blame output
  const lines: BlameInfo[] = [];
  const blameLines = result.split('\n');

  let currentHash = '';
  let currentAuthor = '';
  let currentDate = '';
  let lineNum = startLine;

  for (const line of blameLines) {
    if (line.match(/^[a-f0-9]{40}/)) {
      currentHash = line.substring(0, 40);
    } else if (line.startsWith('author ')) {
      currentAuthor = line.substring(7);
    } else if (line.startsWith('author-time ')) {
      const timestamp = Number.parseInt(line.substring(12), 10);
      currentDate = new Date(timestamp * 1000).toISOString();
    } else if (line.startsWith('\t')) {
      lines.push({
        line: lineNum++,
        hash: currentHash,
        author: currentAuthor,
        date: currentDate,
        content: line.substring(1),
      });
    }
  }

  return lines;
}
