import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

/**
 * Package version, read from package.json at runtime.
 *
 * `package.json` sits one level above both `src/` and `dist/`, so the same
 * specifier resolves whether this module runs from source or compiled output.
 * Read rather than imported so `tsconfig`'s `rootDir: ./src` stays intact — a
 * static `import ... from '../package.json'` would pull the file into the
 * compiled tree and shift every emitted path under `dist/src/`.
 */
const pkg = nodeRequire('../package.json') as { version: string };

export const VERSION: string = pkg.version;
