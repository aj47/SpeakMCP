#!/usr/bin/env node
/**
 * SpeakMCP Filesystem MCP Server
 *
 * A simplified filesystem server with 9 essential tools:
 * - read_text_file: Read file contents with optional head/tail
 * - read_media_file: Read binary files as base64
 * - write_file: Create or overwrite files
 * - edit_file: Make text replacements in files
 * - create_directory: Create directories
 * - list_directory: List directory contents (with optional sizes)
 * - move_file: Move or rename files
 * - search_files: Search for files by pattern
 * - list_allowed_directories: Show accessible directories
 *
 * This is a simplified version of @modelcontextprotocol/server-filesystem
 * with reduced redundancy for better agent experience.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import fs from "fs/promises"
import { createReadStream } from "fs"
import path from "path"
import {
  setAllowedDirectories,
  getAllowedDirectories,
  validatePath,
  expandHome,
  normalizePath,
  readFileContent,
  writeFileContent,
  formatSize,
  tailFile,
  headFile,
  applyFileEdits,
  searchFiles,
  EditOperation,
} from "./lib.js"

// Parse command line arguments for allowed directories
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("Usage: speakmcp-filesystem [allowed-directory] [additional-directories...]")
  console.error("At least one directory must be provided.")
  process.exit(1)
}

// Initialize allowed directories
async function initializeAllowedDirectories(): Promise<string[]> {
  const dirs = await Promise.all(
    args.map(async (dir) => {
      const expanded = expandHome(dir)
      const absolute = path.resolve(expanded)
      try {
        const resolved = await fs.realpath(absolute)
        return normalizePath(resolved)
      } catch {
        return normalizePath(absolute)
      }
    })
  )

  // Validate directories exist
  for (const dir of dirs) {
    try {
      const stats = await fs.stat(dir)
      if (!stats.isDirectory()) {
        console.error(`Error: ${dir} is not a directory`)
        process.exit(1)
      }
    } catch (error) {
      console.error(`Error accessing directory ${dir}:`, error)
      process.exit(1)
    }
  }

  return dirs
}

// Tool definitions - 9 simplified tools
const tools = [
  {
    name: "read_text_file",
    description:
      "Read the contents of a text file. Use 'head' to read only the first N lines, " +
      "or 'tail' to read only the last N lines. Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        head: { type: "number", description: "Optional: Read only the first N lines" },
        tail: { type: "number", description: "Optional: Read only the last N lines" },
      },
      required: ["path"],
    },
  },
  {
    name: "read_media_file",
    description:
      "Read an image or audio file. Returns base64 encoded data and MIME type. " +
      "Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the media file" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing file with new content. " +
      "Use with caution as it will overwrite without warning. Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make text replacements in a file. Each edit specifies old text to find and new text to replace it with. " +
      "Use dryRun to preview changes. Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the file" },
        edits: {
          type: "array",
          description: "Array of edit operations",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string", description: "Text to find" },
              newText: { type: "string", description: "Text to replace with" },
            },
            required: ["oldText", "newText"],
          },
        },
        dryRun: { type: "boolean", description: "Preview changes without applying" },
      },
      required: ["path", "edits"],
    },
  },
  {
    name: "create_directory",
    description:
      "Create a new directory or ensure it exists. Can create nested directories. " +
      "Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the directory to create" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories in a path. Use includeSizes to show file sizes and totals. " +
      "Results show [FILE] or [DIR] prefix. Only works within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the directory" },
        includeSizes: { type: "boolean", description: "Include file sizes in output" },
        sortBy: { type: "string", enum: ["name", "size"], description: "Sort by name or size" },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description:
      "Move or rename files and directories. Both source and destination must be within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Source path" },
        destination: { type: "string", description: "Destination path" },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for files matching a glob pattern. Use patterns like '*.ts' or '**/*.json'. " +
      "Only searches within allowed directories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Base path to search from" },
        pattern: { type: "string", description: "Glob pattern to match" },
        excludePatterns: { type: "array", items: { type: "string" }, description: "Patterns to exclude" },
      },
      required: ["path", "pattern"],
    },
  },
  {
    name: "list_allowed_directories",
    description:
      "Returns the list of directories this server can access. " +
      "Use this to understand which paths are available.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
]

// MIME type mapping for media files
const mimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
}

// Read file as base64 stream
async function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    const chunks: Buffer[] = []
    stream.on("data", (chunk) => chunks.push(chunk as Buffer))
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("base64")))
    stream.on("error", reject)
  })
}

// Create MCP server
const server = new Server(
  { name: "speakmcp-filesystem", version: "1.0.0" },
  { capabilities: { tools: {} } }
)

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case "read_text_file": {
        const { path: filePath, head, tail } = args as { path: string; head?: number; tail?: number }
        const validPath = await validatePath(filePath)

        // Validate head/tail parameters if provided
        if (head !== undefined && (!Number.isInteger(head) || head <= 0)) {
          throw new Error("'head' must be a positive integer")
        }
        if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) {
          throw new Error("'tail' must be a positive integer")
        }

        if (head !== undefined && tail !== undefined) {
          throw new Error("Cannot specify both head and tail")
        }

        let content: string
        if (tail !== undefined) {
          content = await tailFile(validPath, tail)
        } else if (head !== undefined) {
          content = await headFile(validPath, head)
        } else {
          content = await readFileContent(validPath)
        }

        return { content: [{ type: "text", text: content }] }
      }

      case "read_media_file": {
        const { path: filePath } = args as { path: string }
        const validPath = await validatePath(filePath)
        const ext = path.extname(validPath).toLowerCase()
        const mimeType = mimeTypes[ext] || "application/octet-stream"
        const data = await readFileAsBase64(validPath)
        const type = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : "blob"
        return { content: [{ type, data, mimeType } as any] }
      }

      case "write_file": {
        const { path: filePath, content } = args as { path: string; content: string }
        const validPath = await validatePath(filePath)
        await writeFileContent(validPath, content)
        return { content: [{ type: "text", text: `Successfully wrote to ${filePath}` }] }
      }

      case "edit_file": {
        const { path: filePath, edits, dryRun } = args as { path: string; edits: EditOperation[]; dryRun?: boolean }
        const validPath = await validatePath(filePath)
        const result = await applyFileEdits(validPath, edits, dryRun ?? false)
        return { content: [{ type: "text", text: result }] }
      }

      case "create_directory": {
        const { path: dirPath } = args as { path: string }
        const validPath = await validatePath(dirPath)
        await fs.mkdir(validPath, { recursive: true })
        return { content: [{ type: "text", text: `Successfully created directory ${dirPath}` }] }
      }

      case "list_directory": {
        const { path: dirPath, includeSizes, sortBy } = args as { path: string; includeSizes?: boolean; sortBy?: string }
        const validPath = await validatePath(dirPath)
        const entries = await fs.readdir(validPath, { withFileTypes: true })

        if (includeSizes) {
          // Get detailed info with sizes
          const detailed = await Promise.all(
            entries.map(async (entry) => {
              const entryPath = path.join(validPath, entry.name)
              try {
                const stats = await fs.stat(entryPath)
                return { name: entry.name, isDir: entry.isDirectory(), size: stats.size }
              } catch {
                return { name: entry.name, isDir: entry.isDirectory(), size: 0 }
              }
            })
          )

          // Sort entries
          const sorted = [...detailed].sort((a, b) => {
            if (sortBy === "size") return b.size - a.size
            return a.name.localeCompare(b.name)
          })

          const lines = sorted.map((e) =>
            `${e.isDir ? "[DIR]" : "[FILE]"} ${e.name.padEnd(30)} ${e.isDir ? "" : formatSize(e.size).padStart(10)}`
          )
          const totalFiles = detailed.filter((e) => !e.isDir).length
          const totalDirs = detailed.filter((e) => e.isDir).length
          const totalSize = detailed.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0)
          lines.push("", `Total: ${totalFiles} files, ${totalDirs} directories`, `Combined size: ${formatSize(totalSize)}`)
          return { content: [{ type: "text", text: lines.join("\n") }] }
        }

        const formatted = entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n")
        return { content: [{ type: "text", text: formatted }] }
      }

      case "move_file": {
        const { source, destination } = args as { source: string; destination: string }
        const validSource = await validatePath(source)
        const validDest = await validatePath(destination)
        await fs.rename(validSource, validDest)
        return { content: [{ type: "text", text: `Successfully moved ${source} to ${destination}` }] }
      }

      case "search_files": {
        const { path: basePath, pattern, excludePatterns } = args as { path: string; pattern: string; excludePatterns?: string[] }
        const validPath = await validatePath(basePath)
        const results = await searchFiles(validPath, pattern, excludePatterns ?? [])
        const text = results.length > 0 ? results.join("\n") : "No matches found"
        return { content: [{ type: "text", text }] }
      }

      case "list_allowed_directories": {
        const dirs = getAllowedDirectories()
        return { content: [{ type: "text", text: `Allowed directories:\n${dirs.join("\n")}` }] }
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true }
  }
})

// Start the server
async function main() {
  const allowedDirs = await initializeAllowedDirectories()
  setAllowedDirectories(allowedDirs)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("SpeakMCP Filesystem Server running on stdio")
  console.error(`Allowed directories: ${allowedDirs.join(", ")}`)
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})

