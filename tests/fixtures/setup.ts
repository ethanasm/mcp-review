import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SimpleGit, simpleGit } from 'simple-git';

export interface FixtureRepo {
  path: string;
  git: SimpleGit;
  cleanup: () => Promise<void>;
}

export interface FixtureRepoOptions {
  /** Initial files to create: filename -> content */
  files?: Record<string, string>;
  /** Sequence of commits to create after the initial commit */
  commits?: Array<{ message: string; files: Record<string, string> }>;
}

/**
 * Default fixture files with common review issues.
 * Includes:
 * - A file with a console.log that shouldn't be committed
 * - A file with a TODO comment
 * - A file importing another file (for related-files testing)
 */
const DEFAULT_FILES: Record<string, string> = {
  'src/utils.ts': [
    'export function add(a: number, b: number): number {',
    '  return a + b;',
    '}',
    '',
    'export function multiply(a: number, b: number): number {',
    '  return a * b;',
    '}',
    '',
  ].join('\n'),

  'src/debug.ts': [
    'import { add } from "./utils.js";',
    '',
    '// TODO: Remove this debug helper before release',
    'export function debugAdd(a: number, b: number): void {',
    '  const result = add(a, b);',
    '  console.log("Debug result:", result);',
    '}',
    '',
  ].join('\n'),

  'src/index.ts': [
    'import { add, multiply } from "./utils.js";',
    'import { debugAdd } from "./debug.js";',
    '',
    'export { add, multiply, debugAdd };',
    '',
  ].join('\n'),
};

/**
 * Create a temporary git repository for integration testing.
 *
 * Sets up a real git repo in a temp directory with an initial commit,
 * optional additional files, and optional sequences of commits.
 *
 * @example
 * ```ts
 * const repo = await createFixtureRepo();
 * // Use repo.path and repo.git for testing
 * await repo.cleanup();
 * ```
 *
 * @example
 * ```ts
 * const repo = await createFixtureRepo({
 *   files: { 'hello.ts': 'export const hello = "world";' },
 *   commits: [
 *     { message: 'add feature', files: { 'feature.ts': 'export const x = 1;' } },
 *     { message: 'fix bug', files: { 'hello.ts': 'export const hello = "fixed";' } },
 *   ],
 * });
 * ```
 */
export async function createFixtureRepo(options?: FixtureRepoOptions): Promise<FixtureRepo> {
  const prefix = join(tmpdir(), 'mcp-review-test-');
  const repoPath = await mkdtemp(prefix);

  const git = simpleGit(repoPath);

  // Initialize git repo
  await git.init();
  await git.addConfig('user.email', 'test@mcp-review.dev');
  await git.addConfig('user.name', 'Test User');

  // Determine which files to use for the initial commit
  const initialFiles = options?.files ?? DEFAULT_FILES;

  // Write initial files
  await writeFiles(repoPath, initialFiles);

  // Create initial commit
  await git.add('.');
  await git.commit('initial commit');

  // Create additional commits if specified
  if (options?.commits) {
    for (const commit of options.commits) {
      await writeFiles(repoPath, commit.files);
      await git.add('.');
      await git.commit(commit.message);
    }
  }

  return {
    path: repoPath,
    git,
    cleanup: async () => {
      await rm(repoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Create a fixture repo containing files with security anti-patterns.
 * Includes: hardcoded secrets, SQL injection, eval() usage.
 */
export async function createSecurityIssueRepo(): Promise<FixtureRepo> {
  return createFixtureRepo({
    files: {
      'src/db.ts': [
        'const DB_PASSWORD = "supersecret123";',
        'const API_KEY = "sk-live-abc123def456ghi789";',
        '',
        'export function getConnection() {',
        '  return { host: "localhost", password: DB_PASSWORD };',
        '}',
        '',
      ].join('\n'),

      'src/query.ts': [
        'export function findUser(name: string): string {',
        "  return `SELECT * FROM users WHERE name = '${name}'`;",
        '}',
        '',
        'export function deleteUser(id: string): string {',
        '  return `DELETE FROM users WHERE id = ${id}`;',
        '}',
        '',
      ].join('\n'),

      'src/exec.ts': [
        'export function runCode(code: string): unknown {',
        '  return eval(code);',
        '}',
        '',
        'export function buildFunction(body: string): Function {',
        '  return new Function("arg", body);',
        '}',
        '',
      ].join('\n'),
    },
    commits: [
      {
        message: 'add admin bypass',
        files: {
          'src/auth.ts': [
            'export function authenticate(token: string): boolean {',
            '  if (token === "master-override-key") return true;',
            '  return validateToken(token);',
            '}',
            '',
            'function validateToken(token: string): boolean {',
            '  return token.length > 0;',
            '}',
            '',
          ].join('\n'),
        },
      },
    ],
  });
}

/**
 * Create a fixture repo containing files with performance anti-patterns.
 * Includes: N+1 query patterns, large array copies, missing async.
 */
export async function createPerformanceIssueRepo(): Promise<FixtureRepo> {
  return createFixtureRepo({
    files: {
      'src/users.ts': [
        'interface User { id: number; name: string; }',
        'interface Post { id: number; userId: number; title: string; }',
        '',
        '// N+1 query pattern: fetches posts one user at a time',
        'export async function getUsersWithPosts(users: User[]) {',
        '  const results = [];',
        '  for (const user of users) {',
        '    const posts = await fetchPostsByUserId(user.id);',
        '    results.push({ ...user, posts });',
        '  }',
        '  return results;',
        '}',
        '',
        'async function fetchPostsByUserId(userId: number): Promise<Post[]> {',
        '  return [{ id: 1, userId, title: "post" }];',
        '}',
        '',
      ].join('\n'),

      'src/transform.ts': [
        'export function processLargeArray(items: number[]): number[] {',
        '  let result = [...items];',
        '  result = [...result].sort();',
        '  result = [...result].filter(x => x > 0);',
        '  result = [...result].map(x => x * 2);',
        '  return result;',
        '}',
        '',
        'export function findDuplicates(items: string[]): string[] {',
        '  const dupes: string[] = [];',
        '  for (let i = 0; i < items.length; i++) {',
        '    for (let j = i + 1; j < items.length; j++) {',
        '      if (items[i] === items[j] && !dupes.includes(items[i]!)) {',
        '        dupes.push(items[i]!);',
        '      }',
        '    }',
        '  }',
        '  return dupes;',
        '}',
        '',
      ].join('\n'),

      'src/sync-io.ts': [
        'import { readFileSync, readdirSync } from "node:fs";',
        '',
        'export function loadAllConfigs(dir: string): string[] {',
        '  const files = readdirSync(dir);',
        '  return files.map(f => readFileSync(`${dir}/${f}`, "utf-8"));',
        '}',
        '',
      ].join('\n'),
    },
  });
}

/**
 * Create a fixture repo containing files with style/consistency issues.
 * Includes: mixed camelCase/snake_case, missing types, inconsistent patterns.
 */
export async function createStyleIssueRepo(): Promise<FixtureRepo> {
  return createFixtureRepo({
    files: {
      'src/api.ts': [
        'export function get_user_data(user_id: string) {',
        '  const userData = fetchUser(user_id);',
        '  return userData;',
        '}',
        '',
        'export function getUserAge(userId: string) {',
        '  const user_record = fetchUser(userId);',
        '  return user_record;',
        '}',
        '',
        'function fetchUser(id: string) {',
        '  return { id, name: "test" };',
        '}',
        '',
      ].join('\n'),

      'src/handlers.ts': [
        'export const handle_request = (req: any) => {',
        '  const data: any = req.body;',
        '  const result = process_data(data);',
        '  return result;',
        '};',
        '',
        'export const handleResponse = (res: any) => {',
        '  const payload: any = res.data;',
        '  return payload;',
        '};',
        '',
        'function process_data(input: any) {',
        '  return input;',
        '}',
        '',
      ].join('\n'),

      'src/constants.ts': [
        'export const MAX_RETRIES = 3;',
        'export const max_timeout = 5000;',
        'export const DefaultPageSize = 20;',
        'export const api_base_url = "https://api.example.com";',
        '',
      ].join('\n'),
    },
  });
}

/**
 * Create a fixture repo with zero commits (only initialized).
 * Edge case: no HEAD, no refs.
 */
export async function createEmptyRepo(): Promise<FixtureRepo> {
  const prefix = join(tmpdir(), 'mcp-review-test-');
  const repoPath = await mkdtemp(prefix);

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'test@mcp-review.dev');
  await git.addConfig('user.name', 'Test User');

  return {
    path: repoPath,
    git,
    cleanup: async () => {
      await rm(repoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Create a fixture repo with merge commits.
 * Sets up a main branch and a feature branch, then merges.
 */
export async function createMergeConflictRepo(): Promise<FixtureRepo> {
  const prefix = join(tmpdir(), 'mcp-review-test-');
  const repoPath = await mkdtemp(prefix);

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'test@mcp-review.dev');
  await git.addConfig('user.name', 'Test User');

  // Initial commit on main
  await writeFiles(repoPath, {
    'src/main.ts': 'export const version = "1.0.0";\n',
    'src/utils.ts': 'export function greet() { return "hello"; }\n',
  });
  await git.add('.');
  await git.commit('initial commit');

  // Create and switch to feature branch
  await git.checkoutLocalBranch('feature/add-goodbye');

  await writeFiles(repoPath, {
    'src/utils.ts': [
      'export function greet() { return "hello"; }',
      'export function farewell() { return "goodbye"; }',
      '',
    ].join('\n'),
  });
  await git.add('.');
  await git.commit('feat: add farewell function');

  // Switch back to main, make a parallel change
  await git.checkout('main');
  await writeFiles(repoPath, {
    'src/main.ts': 'export const version = "1.1.0";\n',
  });
  await git.add('.');
  await git.commit('bump version');

  // Merge feature branch (non-conflicting so it auto-merges)
  await git.merge(['feature/add-goodbye', '--no-ff']);

  return {
    path: repoPath,
    git,
    cleanup: async () => {
      await rm(repoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Write a map of files to a directory, creating subdirectories as needed.
 */
async function writeFiles(basePath: string, files: Record<string, string>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(basePath, filePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}
