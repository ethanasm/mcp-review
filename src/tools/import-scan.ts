/**
 * Shared scanner for module specifiers on a single source line.
 *
 * The two import scanners (related-files `find_importers` and file-context
 * `findImporters`) each carried their own copy of
 * `import\s+.*?from\s+['"](.+?)['"]|...`. The lazy `.*?` sitting next to
 * `\s+` gives the engine ambiguous ways to split the same line, so a long
 * import statement backtracks super-linearly (SonarQube S5852, "vulnerable to
 * super-linear runtime due to backtracking") — and these scanners run over
 * every line of up to 500 files from an untrusted repository.
 *
 * The pattern below keeps each quantifier over a character set disjoint from
 * whatever follows it (`[\s(]*` then a quote, `[^'"\n]+` then a quote), so
 * there is exactly one way to match and the scan is linear in line length.
 */
const IMPORT_SPECIFIER = /\b(?:from|import|require)[\s(]*['"]([^'"\n]+)['"]/g;

/**
 * Extract every module specifier referenced on a line.
 *
 * Recognises `import x from 'p'`, `import 'p'`, `export … from 'p'`,
 * `import('p')` and `require('p')`.
 */
export function extractImportSpecifiers(line: string): string[] {
  IMPORT_SPECIFIER.lastIndex = 0;
  const specifiers: string[] = [];

  let match: RegExpExecArray | null = IMPORT_SPECIFIER.exec(line);
  while (match !== null) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
    match = IMPORT_SPECIFIER.exec(line);
  }

  return specifiers;
}
