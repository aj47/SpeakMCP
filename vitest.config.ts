import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/shared/**/*.ts',
        'src/shared/**/*.tsx',
        'src/main/panel-position.ts',
        'src/renderer/src/lib/type-guards.ts',
        'src/renderer/src/lib/fixes.ts',
        'src/renderer/src/lib/final-fixes.ts',
        'src/renderer/src/lib/utils.ts',
      ],
      exclude: ['**/*.d.ts', 'out/**', 'build/**', 'scripts/**'],
    },
  },
})

