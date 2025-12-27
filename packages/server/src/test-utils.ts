import { initDatabase, closeDatabase, resetDatabase, getDb } from './db/index.js'

// Initialize in-memory database for tests
export async function setupTestDb(): Promise<void> {
  await initDatabase(':memory:')
}

export function teardownTestDb(): void {
  closeDatabase()
}

export function resetTestDb(): void {
  resetDatabase()
}

export { getDb }

// Mock config for tests
export const testConfig = {
  port: 3456,
  host: '0.0.0.0',
  apiKey: 'test-api-key',
  databasePath: ':memory:',
  openai: {
    apiKey: undefined,
    baseUrl: 'https://api.openai.com/v1',
  },
  groq: {
    apiKey: undefined,
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  gemini: {
    apiKey: undefined,
  },
}

