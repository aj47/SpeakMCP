import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const __dirname = new URL('.', import.meta.url).pathname

export default defineConfig({
  test: {
    // Root directory for tests
    root: resolve(__dirname),
    // E2E tests run sequentially (no parallel)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // 5 minute timeout per test (LLM calls can be slow)
    testTimeout: 300000,
    hookTimeout: 60000,
    // Only include E2E test files
    include: ['**/*.e2e.ts'],
    // Global setup for server lifecycle
    globalSetup: resolve(__dirname, 'setup.ts'),
    // Disable watch mode by default for E2E
    watch: false,
  },
})

