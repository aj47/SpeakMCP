/**
 * Utility functions for the speakmcp-filesystem MCP server
 */

import fs from "fs/promises"
import path from "path"
import { minimatch } from "minimatch"

// Global allowed directories state
let allowedDirectories: string[] = []

export function setAllowedDirectories(dirs: string[]): void {
  allowedDirectories = dirs
}

export function getAllowedDirectories(): string[] {
  return allowedDirectories
}

/**
 * Normalize a path for consistent comparison across platforms
 */
export function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase()
}

/**
 * Expand home directory (~) in a path
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    return path.join(home, p.slice(1))
  }
  return p
}

/**
 * Validate that a path is within allowed directories
 */
export async function validatePath(requestedPath: string): Promise<string> {
  const expanded = expandHome(requestedPath)
  const absolute = path.resolve(expanded)

  // Resolve symlinks to get real path for security
  let realPath: string
  try {
    realPath = await fs.realpath(absolute)
  } catch {
    // If path doesn't exist yet, use the absolute path
    realPath = absolute
  }

  const normalizedPath = normalizePath(realPath)

  // Check if path is within any allowed directory
  const isAllowed = allowedDirectories.some((dir) => {
    const normalizedDir = normalizePath(dir)
    return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep)
  })

  if (!isAllowed) {
    throw new Error(
      `Access denied: ${requestedPath} is outside allowed directories. ` +
        `Allowed directories: ${allowedDirectories.join(", ")}`
    )
  }

  return realPath
}

/**
 * Read file content as text
 */
export async function readFileContent(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8")
}

/**
 * Write content to a file
 */
export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf-8")
}

/**
 * Get file statistics
 */
export async function getFileStats(filePath: string): Promise<Record<string, string>> {
  const stats = await fs.stat(filePath)
  return {
    size: formatSize(stats.size),
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    accessed: stats.atime.toISOString(),
    isDirectory: stats.isDirectory() ? "true" : "false",
    isFile: stats.isFile() ? "true" : "false",
    permissions: stats.mode.toString(8),
  }
}

/**
 * Format file size in human-readable format
 */
export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

/**
 * Read the last N lines of a file
 */
export async function tailFile(filePath: string, lines: number): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8")
  const allLines = content.split("\n")
  return allLines.slice(-lines).join("\n")
}

/**
 * Read the first N lines of a file
 */
export async function headFile(filePath: string, lines: number): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8")
  const allLines = content.split("\n")
  return allLines.slice(0, lines).join("\n")
}

export interface EditOperation {
  oldText: string
  newText: string
}

/**
 * Apply text edits to a file
 */
export async function applyFileEdits(
  filePath: string,
  edits: EditOperation[],
  dryRun: boolean = false
): Promise<string> {
  let content = await fs.readFile(filePath, "utf-8")
  const originalContent = content

  for (const edit of edits) {
    if (!content.includes(edit.oldText)) {
      throw new Error(`Could not find text to replace: "${edit.oldText.slice(0, 50)}..."`)
    }
    content = content.replace(edit.oldText, edit.newText)
  }

  if (dryRun) {
    // Generate a simple diff
    const originalLines = originalContent.split("\n")
    const newLines = content.split("\n")
    const diff: string[] = []

    let i = 0, j = 0
    while (i < originalLines.length || j < newLines.length) {
      if (i < originalLines.length && j < newLines.length && originalLines[i] === newLines[j]) {
        diff.push(`  ${originalLines[i]}`)
        i++
        j++
      } else if (i < originalLines.length && (j >= newLines.length || originalLines[i] !== newLines[j])) {
        diff.push(`- ${originalLines[i]}`)
        i++
      } else if (j < newLines.length) {
        diff.push(`+ ${newLines[j]}`)
        j++
      }
    }
    return diff.join("\n")
  }

  await fs.writeFile(filePath, content, "utf-8")
  return `Successfully applied ${edits.length} edit(s) to ${filePath}`
}

/**
 * Search for files matching a pattern
 */
export async function searchFiles(
  basePath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = []

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      const relativePath = path.relative(basePath, entryPath)

      // Check if should exclude
      const shouldExclude = excludePatterns.some((excludePattern) => {
        return minimatch(relativePath, excludePattern, { dot: true }) ||
          minimatch(relativePath, `**/${excludePattern}`, { dot: true })
      })

      if (shouldExclude) continue

      // Check if matches pattern
      if (minimatch(relativePath, pattern, { dot: true }) ||
          minimatch(entry.name, pattern, { dot: true })) {
        results.push(entryPath)
      }

      // Recurse into directories
      if (entry.isDirectory()) {
        try {
          await walk(entryPath)
        } catch {
          // Skip directories we can't access
        }
      }
    }
  }

  await walk(basePath)
  return results
}

