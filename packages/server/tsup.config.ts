import { defineConfig } from 'tsup'

export default defineConfig([
  // CLI entry point (executable)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node'
    },
    noExternal: ['@speakmcp/shared']
  },
  // Library entry point (for embedding)
  {
    entry: { lib: 'src/lib.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    shims: true,
    noExternal: ['@speakmcp/shared']
  }
])

