import path from 'path'
import os from 'os'
import { COMMON_NODE_PATHS, FILE_EXTENSIONS, PLATFORM, ERROR_MESSAGES } from '../../shared/constants'

/**
 * Common path utilities to reduce code duplication
 */

/**
 * Get common Node.js paths with home directory resolved
 */
export function getCommonNodePaths(): string[] {
  return COMMON_NODE_PATHS.map(nodePath => {
    if (nodePath.startsWith('~/')) {
      return path.join(os.homedir(), nodePath.slice(2))
    }
    return nodePath
  })
}

/**
 * Get platform-specific path separator
 */
export function getPathSeparator(): string {
  return process.platform === 'win32' 
    ? PLATFORM.PATH_SEPARATOR.WIN32 
    : PLATFORM.PATH_SEPARATOR.UNIX
}

/**
 * Get platform-specific executable extensions
 */
export function getExecutableExtensions(): string[] {
  return process.platform === 'win32' 
    ? FILE_EXTENSIONS.WINDOWS_EXECUTABLES 
    : FILE_EXTENSIONS.UNIX_EXECUTABLES
}

/**
 * Prepare environment with enhanced PATH
 */
export function prepareEnvironmentWithPaths(
  baseEnv: Record<string, string> = process.env as Record<string, string>,
  additionalPaths: string[] = []
): Record<string, string> {
  // Create a clean environment with only string values
  const environment: Record<string, string> = {}
  
  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      environment[key] = value
    }
  }
  
  // Ensure PATH is properly set
  if (!environment.PATH) {
    environment.PATH = PLATFORM.DEFAULT_PATH
  }
  
  // Add common Node.js paths and additional paths
  const pathsToAdd = [...getCommonNodePaths(), ...additionalPaths]
  const pathSeparator = getPathSeparator()
  const currentPaths = environment.PATH.split(pathSeparator)
  
  for (const pathToAdd of pathsToAdd) {
    if (!currentPaths.includes(pathToAdd)) {
      environment.PATH += pathSeparator + pathToAdd
    }
  }
  
  return environment
}

/**
 * Check if a command might be an npm package
 */
export function isNpmPackage(command: string): boolean {
  return command === 'npx' || command.startsWith('@')
}

/**
 * Create error message for missing npm commands
 */
export function createNpmNotFoundError(command: string): Error {
  if (isNpmPackage(command)) {
    return new Error(ERROR_MESSAGES.NPX_NOT_FOUND)
  }
  return new Error(`Command not found: ${command}`)
}

/**
 * Resolve command path with platform-specific extensions
 */
export async function resolveCommandPath(
  command: string,
  searchPaths?: string[]
): Promise<string> {
  const { promises: fs, constants } = await import('fs')
  
  // If it's an absolute path, return as-is
  if (path.isAbsolute(command)) {
    return command
  }
  
  // Get system PATH and additional search paths
  const systemPath = process.env.PATH || ''
  const pathSeparator = getPathSeparator()
  const pathExtensions = getExecutableExtensions()
  
  // Combine all search paths
  const allPaths = [
    ...systemPath.split(pathSeparator),
    ...getCommonNodePaths(),
    ...(searchPaths || [])
  ]
  
  // Search for the command
  for (const dir of allPaths) {
    if (!dir) continue
    
    for (const ext of pathExtensions) {
      const fullPath = path.join(dir, command + ext)
      try {
        await fs.access(fullPath, constants.F_OK | constants.X_OK)
        return fullPath
      } catch {
        // Continue searching
      }
    }
  }
  
  // If not found, check if it's an npm package and throw appropriate error
  if (isNpmPackage(command)) {
    throw createNpmNotFoundError(command)
  }
  
  // Return original command and let the system handle it
  return command
}

/**
 * Normalize path separators for the current platform
 */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath)
}

/**
 * Join paths safely
 */
export function joinPaths(...paths: string[]): string {
  return path.join(...paths)
}

/**
 * Get file extension
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath)
}

/**
 * Check if file has audio extension
 */
export function isAudioFile(filePath: string): boolean {
  const ext = getFileExtension(filePath).toLowerCase()
  return FILE_EXTENSIONS.AUDIO.includes(ext)
}

/**
 * Create safe filename from string
 */
export function createSafeFilename(input: string, maxLength: number = 255): string {
  // Remove or replace unsafe characters
  const safe = input
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim()
  
  // Truncate if too long
  if (safe.length > maxLength) {
    return safe.substring(0, maxLength - 3) + '...'
  }
  
  return safe
}

/**
 * Get relative path from base to target
 */
export function getRelativePath(from: string, to: string): string {
  return path.relative(from, to)
}

/**
 * Check if path is within a directory
 */
export function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}
