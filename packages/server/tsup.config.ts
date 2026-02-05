import { defineConfig } from 'tsup'

export default defineConfig([
  // CLI entry point (with shebang)
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
  // Library exports (no shebang)
  {
    entry: {
      server: 'src/server.ts',
      'config/index': 'src/config/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    shims: true,
    noExternal: ['@speakmcp/shared']
  },
])

