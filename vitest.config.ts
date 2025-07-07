import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'out/',
        'build/',
        'coverage/',
        'scripts/',
        'resources/',
        'speakmcp-rs/'
      ]
    }
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, './src/main'),
      '@renderer': resolve(__dirname, './src/renderer/src'),
      '@shared': resolve(__dirname, './src/shared'),
      '@preload': resolve(__dirname, './src/preload')
    }
  }
})
