import { defineConfig } from 'tsup';

export default defineConfig([
  // Library build (no shebang)
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  // CLI build (with shebang for ESM only)
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

