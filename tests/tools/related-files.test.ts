import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleFindExports,
  handleFindImporters,
  handleFindTestFiles,
  handleFindTypeReferences,
} from '../../src/tools/related-files/handlers.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

const { readFile, readdir } = await import('node:fs/promises');

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to create a mock Dirent
function mockDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  };
}

describe('handleFindImporters', () => {
  it('finds files that import the target file', async () => {
    // Project has two files: consumer.ts imports target.ts
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('target.ts', false),
        mockDirent('consumer.ts', false),
      ] as never);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('consumer.ts')) {
        return "import { foo } from './target.js';\n\nconsole.log(foo);\n";
      }
      if (p.endsWith('target.ts')) {
        return 'export const foo = 42;\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindImporters({
      file_path: 'src/target.ts',
      project_root: '/project',
    });

    expect(result).toContain('consumer.ts');
    expect(result).toContain('import');
    expect(result).toMatch(/Found 1 file/);
  });

  it('finds require() style imports', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([mockDirent('lib.ts', false), mockDirent('main.ts', false)] as never);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('main.ts')) {
        return "const lib = require('./lib');\n";
      }
      if (p.endsWith('lib.ts')) {
        return 'module.exports = {};\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindImporters({
      file_path: 'src/lib.ts',
      project_root: '/project',
    });

    expect(result).toContain('main.ts');
    expect(result).toContain('require');
  });

  it('returns message when no importers found', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([mockDirent('lonely.ts', false)] as never);

    vi.mocked(readFile).mockImplementation(async () => {
      return 'const x = 1;\n';
    });

    const result = await handleFindImporters({
      file_path: 'lonely.ts',
      project_root: '/project',
    });

    expect(result).toContain('No files found that import');
  });

  it('skips node_modules and other excluded directories', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        mockDirent('node_modules', true),
        mockDirent('dist', true),
        mockDirent('src', true),
      ] as never)
      .mockResolvedValueOnce([mockDirent('app.ts', false)] as never);

    vi.mocked(readFile).mockImplementation(async () => {
      return 'const x = 1;\n';
    });

    await handleFindImporters({
      file_path: 'src/app.ts',
      project_root: '/project',
    });

    // readdir should NOT be called for node_modules or dist
    expect(vi.mocked(readdir)).toHaveBeenCalledTimes(2); // root + src only
  });
});

describe('handleFindExports', () => {
  it('finds named exports', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      'export const FOO = 1;\nexport function bar() {}\nexport class Baz {}\n',
    );

    const result = await handleFindExports({ file_path: '/project/src/utils.ts' });

    expect(result).toContain('[named] FOO');
    expect(result).toContain('[named] bar');
    expect(result).toContain('[named] Baz');
    expect(result).toMatch(/Found 3 exports/);
  });

  it('finds default exports', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('export default function myFunc() { return 1; }\n');

    const result = await handleFindExports({ file_path: '/project/src/main.ts' });

    expect(result).toContain('[default] myFunc');
  });

  it('finds anonymous default exports', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('export default { key: "value" };\n');

    const result = await handleFindExports({ file_path: '/project/src/config.ts' });

    expect(result).toContain('[default] (anonymous)');
  });

  it('finds re-exports', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      "export * from './other.js';\nexport { named } from './named.js';\n",
    );

    const result = await handleFindExports({ file_path: '/project/src/index.ts' });

    expect(result).toContain('[re-export]');
    expect(result).toMatch(/Found 2 exports/);
  });

  it('finds export list syntax', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('const a = 1;\nconst b = 2;\nexport { a, b };\n');

    const result = await handleFindExports({ file_path: '/project/src/values.ts' });

    expect(result).toContain('[named] a');
    expect(result).toContain('[named] b');
  });

  it('finds interface and type exports', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      'export interface Foo {}\nexport type Bar = string;\nexport enum Status { A, B }\n',
    );

    const result = await handleFindExports({ file_path: '/project/src/types.ts' });

    expect(result).toContain('[named] Foo');
    expect(result).toContain('[named] Bar');
    expect(result).toContain('[named] Status');
  });

  it('returns message when no exports found', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('const internal = 1;\n');

    const result = await handleFindExports({ file_path: '/project/src/internal.ts' });

    expect(result).toContain('No exports found');
  });

  it('throws on unreadable file', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(handleFindExports({ file_path: '/project/src/missing.ts' })).rejects.toThrow(
      'Cannot read file',
    );
  });
});

describe('handleFindTestFiles', () => {
  it('finds .test.ts file in same directory', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p === '/project/src/utils.test.ts') {
        return 'test content';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTestFiles({
      file_path: 'src/utils.ts',
      project_root: '/project',
    });

    expect(result).toContain('src/utils.test.ts');
    expect(result).toMatch(/Found 1 test file/);
  });

  it('finds .spec.ts file in same directory', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p === '/project/src/utils.spec.ts') {
        return 'test content';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTestFiles({
      file_path: 'src/utils.ts',
      project_root: '/project',
    });

    expect(result).toContain('src/utils.spec.ts');
  });

  it('finds test file in __tests__ directory', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p === '/project/src/__tests__/utils.test.ts') {
        return 'test content';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTestFiles({
      file_path: 'src/utils.ts',
      project_root: '/project',
    });

    expect(result).toContain('__tests__/utils.test.ts');
  });

  it('finds test file in mirrored tests/ directory', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p === '/project/tests/utils.test.ts') {
        return 'test content';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTestFiles({
      file_path: 'src/utils.ts',
      project_root: '/project',
    });

    expect(result).toContain('tests/utils.test.ts');
  });

  it('finds multiple test files', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p === '/project/src/utils.test.ts' || p === '/project/src/utils.spec.ts') {
        return 'test content';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTestFiles({
      file_path: 'src/utils.ts',
      project_root: '/project',
    });

    expect(result).toContain('src/utils.test.ts');
    expect(result).toContain('src/utils.spec.ts');
    expect(result).toMatch(/Found 2 test files/);
  });

  it('returns message when no test files found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const result = await handleFindTestFiles({
      file_path: 'src/untested.ts',
      project_root: '/project',
    });

    expect(result).toContain('No test files found');
  });
});

describe('handleFindTypeReferences', () => {
  it('finds type references across files', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('types.ts', false),
        mockDirent('consumer.ts', false),
      ] as never);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('types.ts')) {
        return 'export interface ReviewConfig {\n  model: string;\n}\n';
      }
      if (p.endsWith('consumer.ts')) {
        return "import { ReviewConfig } from './types.js';\n\nfunction use(config: ReviewConfig) {}\n";
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindTypeReferences({
      type_name: 'ReviewConfig',
      project_root: '/project',
    });

    expect(result).toContain('ReviewConfig');
    expect(result).toContain('types.ts');
    expect(result).toContain('consumer.ts');
  });

  it('matches whole words only', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([mockDirent('code.ts', false)] as never);

    vi.mocked(readFile).mockResolvedValueOnce(
      'const Config = 1;\nconst MyConfig = 2;\nconst ConfigExtra = 3;\n',
    );

    const result = await handleFindTypeReferences({
      type_name: 'Config',
      project_root: '/project',
    });

    // Should match "Config" on line 1, but NOT "MyConfig" or "ConfigExtra"
    // since \bConfig\b matches word boundary
    expect(result).toContain('code.ts:1:');
    expect(result).toMatch(/Found 1 reference/);
  });

  it('returns message when no references found', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([mockDirent('code.ts', false)] as never);

    vi.mocked(readFile).mockResolvedValueOnce('const x = 1;\n');

    const result = await handleFindTypeReferences({
      type_name: 'NonExistentType',
      project_root: '/project',
    });

    expect(result).toContain('No references found');
  });

  it('handles regex special characters in type names', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([mockDirent('code.ts', false)] as never);

    vi.mocked(readFile).mockResolvedValueOnce('const x = 1;\n');

    // Should not throw with special regex chars
    const result = await handleFindTypeReferences({
      type_name: 'Foo$Bar',
      project_root: '/project',
    });

    expect(result).toContain('No references found');
  });

  it('skips unreadable files without crashing', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('broken.ts', false),
        mockDirent('good.ts', false),
      ] as never);

    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockResolvedValueOnce('const MyType = 1;\n');

    const result = await handleFindTypeReferences({
      type_name: 'MyType',
      project_root: '/project',
    });

    // Should skip broken.ts and still find the match in good.ts
    expect(result).toContain('good.ts');
    expect(result).toMatch(/Found 1 reference/);
  });
});

describe('handleFindImporters edge cases', () => {
  it('finds non-relative (bare) imports', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('target.ts', false),
        mockDirent('consumer.ts', false),
      ] as never);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('consumer.ts')) {
        return "import { foo } from 'src/target';\n";
      }
      if (p.endsWith('target.ts')) {
        return 'export const foo = 42;\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindImporters({
      file_path: 'src/target.ts',
      project_root: '/project',
    });

    // Non-relative import 'src/target' should match against target 'src/target'
    expect(result).toContain('consumer.ts');
  });

  it('skips unreadable files in import scan', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('broken.ts', false),
        mockDirent('good.ts', false),
      ] as never);

    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce("import { x } from './broken';\n");

    const result = await handleFindImporters({
      file_path: 'src/target.ts',
      project_root: '/project',
    });

    // Should not crash, just skip the unreadable file
    expect(result).toBeDefined();
  });

  it('handles directory read failure gracefully', async () => {
    vi.mocked(readdir).mockRejectedValueOnce(new Error('EACCES'));

    const result = await handleFindImporters({
      file_path: 'src/target.ts',
      project_root: '/project',
    });

    expect(result).toContain('No files found that import');
  });

  it('handles dynamic import() syntax', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('src', true)] as never)
      .mockResolvedValueOnce([
        mockDirent('target.ts', false),
        mockDirent('consumer.ts', false),
      ] as never);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('consumer.ts')) {
        return "const mod = import('./target.js');\n";
      }
      if (p.endsWith('target.ts')) {
        return 'export const foo = 42;\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleFindImporters({
      file_path: 'src/target.ts',
      project_root: '/project',
    });

    expect(result).toContain('consumer.ts');
    expect(result).toContain('import');
  });
});
