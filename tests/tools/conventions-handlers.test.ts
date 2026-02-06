import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleFindSimilarPatterns,
  handleGetProjectConventions,
  handleScanLintConfig,
} from '../../src/tools/conventions/handlers.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

const { readFile, readdir } = await import('node:fs/promises');

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('handleScanLintConfig', () => {
  it('finds and reads config files', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('tsconfig.json')) {
        return '{"compilerOptions": {"strict": true}}';
      }
      if (p.endsWith('biome.json')) {
        return '{"linter": {"enabled": true}, "formatter": {"enabled": true}}';
      }
      throw new Error('ENOENT');
    });

    const result = await handleScanLintConfig({ project_root: '/project' });

    expect(result).toContain('tsconfig.json');
    expect(result).toContain('strict');
    expect(result).toContain('biome.json');
    expect(result).toContain('linter');
  });

  it('returns message when no configs found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const result = await handleScanLintConfig({ project_root: '/project' });

    expect(result).toContain('No lint or formatting configuration');
  });

  it('truncates very large config files', async () => {
    const largeContent = 'x'.repeat(6000);
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('tsconfig.json')) {
        return largeContent;
      }
      throw new Error('ENOENT');
    });

    const result = await handleScanLintConfig({ project_root: '/project' });

    expect(result).toContain('truncated');
    expect(result.length).toBeLessThan(6000);
  });
});

describe('handleFindSimilarPatterns', () => {
  it('finds pattern matches in source files', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        mockDirent('src', true),
      ] as never)
      .mockResolvedValueOnce([
        mockDirent('utils.ts', false),
      ] as never);

    vi.mocked(readFile).mockResolvedValue(
      'import { foo } from "./bar";\nexport function doThing() {}\n',
    );

    const result = await handleFindSimilarPatterns({
      pattern: 'doThing',
      project_root: '/project',
    });

    expect(result).toContain('doThing');
    expect(result).toMatch(/Found 1 match/);
  });

  it('returns message when no matches found', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      mockDirent('empty.ts', false),
    ] as never);

    vi.mocked(readFile).mockResolvedValue('const x = 1;\n');

    const result = await handleFindSimilarPatterns({
      pattern: 'nonexistent',
      project_root: '/project',
    });

    expect(result).toContain('No matches found');
  });

  it('skips node_modules', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      mockDirent('node_modules', true),
      mockDirent('src', true),
    ] as never)
    .mockResolvedValueOnce([
      mockDirent('app.ts', false),
    ] as never);

    vi.mocked(readFile).mockResolvedValue('const x = 1;\n');

    const result = await handleFindSimilarPatterns({
      pattern: 'x',
      project_root: '/project',
    });

    // Should only scan src/app.ts, not node_modules
    expect(result).toContain('Found 1 match');
  });
});

describe('handleGetProjectConventions', () => {
  it('reads conventions from .mcp-review.yml', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.mcp-review.yml')) {
        return 'conventions:\n  - Use camelCase\n  - No console.log\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleGetProjectConventions({ project_root: '/project' });
    const parsed = JSON.parse(result);

    expect(parsed).toContain('Use camelCase');
    expect(parsed).toContain('No console.log');
  });

  it('falls back to .mcp-review.yaml', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.mcp-review.yaml')) {
        return 'model: claude-opus-4-20250514\n';
      }
      throw new Error('ENOENT');
    });

    const result = await handleGetProjectConventions({ project_root: '/project' });
    const parsed = JSON.parse(result);

    expect(parsed.model).toBe('claude-opus-4-20250514');
  });

  it('returns message when no config file found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const result = await handleGetProjectConventions({ project_root: '/project' });

    expect(result).toContain('No .mcp-review.yml');
  });

  it('returns error message for invalid YAML', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.mcp-review.yml')) {
        return '{{invalid: yaml: [';
      }
      throw new Error('ENOENT');
    });

    const result = await handleGetProjectConventions({ project_root: '/project' });

    expect(result).toContain('Error parsing');
  });

  it('handles empty/null config file', async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.mcp-review.yml')) {
        return '';
      }
      throw new Error('ENOENT');
    });

    const result = await handleGetProjectConventions({ project_root: '/project' });

    expect(result).toContain('empty or invalid');
  });
});
