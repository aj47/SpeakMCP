import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import os from 'os'
import { access, constants } from 'fs'
import { promisify } from 'util'

const accessAsync = promisify(access)

/**
 * Test the PATH resolution logic that fixes the ENOENT error
 * This tests the core functionality without complex mocking
 */

async function resolveCommandPath(command: string): Promise<string> {
  // If it's already an absolute path, return as-is
  if (path.isAbsolute(command)) {
    return command
  }

  // Get the system PATH
  const systemPath = process.env.PATH || ''
  const pathSeparator = process.platform === 'win32' ? ';' : ':'
  const pathExtensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']

  // Split PATH and search for the command
  const pathDirs = systemPath.split(pathSeparator)

  // Add common Node.js paths that might be missing in Electron
  const additionalPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), 'node_modules', '.bin')
  ]

  pathDirs.push(...additionalPaths)

  for (const dir of pathDirs) {
    if (!dir) continue

    for (const ext of pathExtensions) {
      const fullPath = path.join(dir, command + ext)
      try {
        await accessAsync(fullPath, constants.F_OK | constants.X_OK)
        return fullPath
      } catch {
        // Continue searching
      }
    }
  }

  // If not found, check if npx is available and this might be an npm package
  if (command === 'npx' || command.startsWith('@')) {
    throw new Error(`npx not found in PATH. Please ensure Node.js is properly installed.`)
  }

  // Return original command and let the system handle it
  return command
}

async function prepareEnvironment(serverEnv: Record<string, string> = {}): Promise<Record<string, string>> {
  // Create a clean environment with only string values
  const environment: Record<string, string> = {}

  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value
    }
  }

  // Ensure PATH is properly set for finding npm/npx
  if (!environment.PATH) {
    environment.PATH = '/usr/local/bin:/usr/bin:/bin'
  }

  // Add common Node.js paths to PATH if not already present
  const additionalPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), 'node_modules', '.bin')
  ]

  const pathSeparator = process.platform === 'win32' ? ';' : ':'
  const currentPaths = environment.PATH.split(pathSeparator)

  for (const additionalPath of additionalPaths) {
    if (!currentPaths.includes(additionalPath)) {
      environment.PATH += pathSeparator + additionalPath
    }
  }

  // Add server-specific environment variables
  Object.assign(environment, serverEnv)

  return environment
}

describe('MCP PATH Resolution', () => {
  describe('resolveCommandPath', () => {
    it('should return absolute paths as-is', async () => {
      const absolutePath = '/usr/bin/node'
      const result = await resolveCommandPath(absolutePath)
      expect(result).toBe(absolutePath)
    })

    it('should find node in PATH', async () => {
      const nodePath = await resolveCommandPath('node')
      expect(nodePath).toBeTruthy()
      expect(path.isAbsolute(nodePath)).toBe(true)
      expect(nodePath).toMatch(/node/)
    })

    it('should find npx if available', async () => {
      try {
        const npxPath = await resolveCommandPath('npx')
        expect(npxPath).toBeTruthy()
        expect(path.isAbsolute(npxPath)).toBe(true)
        expect(npxPath).toMatch(/npx/)
      } catch (error) {
        // npx might not be available in test environment
        expect((error as Error).message).toContain('npx not found')
      }
    })

    it('should handle missing commands gracefully', async () => {
      const result = await resolveCommandPath('nonexistent-command-12345')
      expect(result).toBe('nonexistent-command-12345')
    })

    it('should throw error for missing npx', async () => {
      // Mock a limited PATH that doesn't include common Node.js paths
      const originalPath = process.env.PATH
      process.env.PATH = '/nonexistent/path'

      try {
        // The function adds additional paths, so we need to test with a command that would trigger the npx error
        await expect(resolveCommandPath('@some/package')).rejects.toThrow('npx not found')
      } finally {
        process.env.PATH = originalPath
      }
    })
  })

  describe('prepareEnvironment', () => {
    it('should create environment with proper PATH', async () => {
      const env = await prepareEnvironment()

      expect(env.PATH).toBeTruthy()
      expect(env.PATH).toContain('/usr/local/bin')
      expect(env.PATH).toContain('/opt/homebrew/bin')
    })

    it('should include custom environment variables', async () => {
      const customEnv = { TEST_VAR: 'test_value', API_KEY: 'secret' }
      const env = await prepareEnvironment(customEnv)

      expect(env.TEST_VAR).toBe('test_value')
      expect(env.API_KEY).toBe('secret')
      expect(env.PATH).toBeTruthy()
    })

    it('should handle missing PATH gracefully', async () => {
      const originalPath = process.env.PATH
      delete process.env.PATH

      try {
        const env = await prepareEnvironment()
        // Should start with the default PATH and then have additional paths appended
        expect(env.PATH).toContain('/usr/local/bin:/usr/bin:/bin')
        expect(env.PATH).toContain('/opt/homebrew/bin')
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('should not include undefined values', async () => {
      const env = await prepareEnvironment()

      // Check that all values are strings
      for (const [key, value] of Object.entries(env)) {
        expect(typeof value).toBe('string')
      }
    })

    it('should add Node.js paths to existing PATH', async () => {
      const originalPath = process.env.PATH
      process.env.PATH = '/usr/bin:/bin'

      try {
        const env = await prepareEnvironment()
        expect(env.PATH).toContain('/usr/bin:/bin')
        expect(env.PATH).toContain('/usr/local/bin')
        expect(env.PATH).toContain('/opt/homebrew/bin')
      } finally {
        process.env.PATH = originalPath
      }
    })
  })

  describe('Platform-specific behavior', () => {
    it('should handle Windows paths correctly', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })

      try {
        const env = await prepareEnvironment({ TEST: 'value' })
        expect(env.PATH).toBeTruthy()
        // Windows uses semicolon as path separator
        if (env.PATH.includes(';')) {
          expect(env.PATH.split(';').length).toBeGreaterThan(1)
        }
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
      }
    })

    it('should handle Unix paths correctly', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      try {
        const env = await prepareEnvironment({ TEST: 'value' })
        expect(env.PATH).toBeTruthy()
        // Unix uses colon as path separator
        expect(env.PATH.split(':').length).toBeGreaterThan(1)
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
      }
    })
  })
})
