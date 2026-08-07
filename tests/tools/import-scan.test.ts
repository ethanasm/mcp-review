import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers } from '../../src/tools/import-scan.js';

describe('extractImportSpecifiers', () => {
  it('extracts a named import specifier', () => {
    expect(extractImportSpecifiers("import { foo } from './target.js';")).toEqual(['./target.js']);
  });

  it('extracts a default import specifier', () => {
    expect(extractImportSpecifiers("import foo from 'src/target';")).toEqual(['src/target']);
  });

  it('extracts a side-effect import specifier', () => {
    expect(extractImportSpecifiers("import './polyfill.js';")).toEqual(['./polyfill.js']);
  });

  it('extracts a dynamic import() specifier', () => {
    expect(extractImportSpecifiers("const mod = import('./target.js');")).toEqual(['./target.js']);
  });

  it('extracts a require() specifier', () => {
    expect(extractImportSpecifiers("const lib = require('./lib');")).toEqual(['./lib']);
  });

  it('extracts a re-export specifier', () => {
    expect(extractImportSpecifiers("export { named } from './named.js';")).toEqual(['./named.js']);
  });

  it('handles double-quoted specifiers', () => {
    expect(extractImportSpecifiers('import { foo } from "./target.js";')).toEqual(['./target.js']);
  });

  it('extracts every specifier on a line with several', () => {
    expect(extractImportSpecifiers("require('./a'); require('./b');")).toEqual(['./a', './b']);
  });

  it('returns nothing for a line with no module reference', () => {
    expect(extractImportSpecifiers('const x = 1;')).toEqual([]);
  });

  it('returns nothing for an import with no quoted specifier', () => {
    expect(extractImportSpecifiers('import {')).toEqual([]);
  });

  it('does not carry regex state between calls', () => {
    const line = "import { foo } from './target.js';";
    expect(extractImportSpecifiers(line)).toEqual(['./target.js']);
    expect(extractImportSpecifiers(line)).toEqual(['./target.js']);
  });

  it('stays linear on a pathological line instead of backtracking', () => {
    // The old `import\s+.*?from\s+['"](.+?)['"]` pattern hung on input like
    // this; the scan must finish promptly and find nothing.
    const hostile = `import ${' '.repeat(20_000)}from`;
    const started = Date.now();
    expect(extractImportSpecifiers(hostile)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
