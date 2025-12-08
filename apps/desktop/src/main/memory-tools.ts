/**
 * Memory Tools for Agent Self-Editing
 *
 * Based on MemGPT paper (arXiv:2310.08560) and Letta framework:
 * - core_memory_replace: Replace content in memory blocks
 * - core_memory_append: Append content to memory blocks
 * - archival_memory_insert: Store information in long-term memory
 * - archival_memory_search: Search long-term memory
 *
 * These tools allow the agent to manage its own memory autonomously,
 * enabling learning and persistence across conversations.
 */

import { memoryService } from "./memory-service"
import type { MCPTool, MCPToolResult } from "./mcp-service"

// The virtual server name for memory tools
export const MEMORY_SERVER_NAME = "speakmcp-memory"

/**
 * Memory tool definitions following MCP schema
 */
export const memoryTools: MCPTool[] = [
  {
    name: `${MEMORY_SERVER_NAME}:core_memory_replace`,
    description:
      "Replace content in a core memory block. Use this to update stored information. You must provide the exact old content to replace.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            'The memory block to edit (e.g., "human", "persona", "task_context")',
        },
        old_content: {
          type: "string",
          description:
            "The exact text to replace (must match exactly what is in the block)",
        },
        new_content: {
          type: "string",
          description: "The new text to insert in place of old_content",
        },
      },
      required: ["label", "old_content", "new_content"],
    },
  },
  {
    name: `${MEMORY_SERVER_NAME}:core_memory_append`,
    description:
      "Append new content to a core memory block. Use this to add new information without modifying existing content.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            'The memory block to append to (e.g., "human", "persona", "task_context")',
        },
        content: {
          type: "string",
          description: "The content to append to the memory block",
        },
      },
      required: ["label", "content"],
    },
  },
  {
    name: `${MEMORY_SERVER_NAME}:core_memory_view`,
    description:
      "View the current contents of all core memory blocks or a specific block.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            'Optional: specific block to view (e.g., "human"). If not provided, shows all blocks.',
        },
      },
      required: [],
    },
  },
  {
    name: `${MEMORY_SERVER_NAME}:archival_memory_insert`,
    description:
      "Store information in long-term archival memory. Use this for facts, experiences, or knowledge that should persist but doesn't fit in core memory.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The information to store in archival memory",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional tags to categorize this memory (e.g., ['preference', 'coding'])",
        },
        importance: {
          type: "number",
          description:
            "Importance score from 0 to 1 (default: 0.5). Higher importance memories are retained longer.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: `${MEMORY_SERVER_NAME}:archival_memory_search`,
    description:
      "Search long-term archival memory for relevant information. Returns the most relevant stored memories.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant memories",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: `${MEMORY_SERVER_NAME}:memory_stats`,
    description:
      "Get statistics about memory usage, including core memory utilization and archival memory count.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
]

/**
 * Tool execution handlers
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>

const toolHandlers: Record<string, ToolHandler> = {
  core_memory_replace: async (args): Promise<MCPToolResult> => {
    const label = args.label as string
    const oldContent = args.old_content as string
    const newContent = args.new_content as string

    if (!label || typeof label !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "label is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    if (typeof oldContent !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "old_content is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    if (typeof newContent !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "new_content is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    const result = memoryService.coreMemoryReplace(label, oldContent, newContent)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      isError: !result.success,
    }
  },

  core_memory_append: async (args): Promise<MCPToolResult> => {
    const label = args.label as string
    const content = args.content as string

    if (!label || typeof label !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "label is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    if (!content || typeof content !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "content is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    const result = memoryService.coreMemoryAppend(label, content)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      isError: !result.success,
    }
  },

  core_memory_view: async (args): Promise<MCPToolResult> => {
    const label = args.label as string | undefined

    if (label) {
      const block = memoryService.getMemoryBlock(label)
      if (!block) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Memory block '${label}' not found`,
                availableBlocks: memoryService
                  .getCoreMemory()
                  .map((b) => b.label),
              }),
            },
          ],
          isError: true,
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              label: block.label,
              description: block.description,
              value: block.value,
              usage: `${block.value.length}/${block.limit} chars`,
              readOnly: block.readOnly,
              updatedAt: new Date(block.updatedAt).toISOString(),
            }),
          },
        ],
        isError: false,
      }
    }

    // Return all blocks
    const blocks = memoryService.getCoreMemory().map((b) => ({
      label: b.label,
      description: b.description,
      value: b.value,
      usage: `${b.value.length}/${b.limit} chars`,
      readOnly: b.readOnly,
    }))

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ blocks }, null, 2),
        },
      ],
      isError: false,
    }
  },

  archival_memory_insert: async (args): Promise<MCPToolResult> => {
    const content = args.content as string
    const tags = (args.tags as string[]) || []
    const importance = (args.importance as number) ?? 0.5

    if (!content || typeof content !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "content is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    const result = memoryService.archivalMemoryInsert(
      content,
      tags,
      "agent",
      importance
    )

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      isError: !result.success,
    }
  },

  archival_memory_search: async (args): Promise<MCPToolResult> => {
    const query = args.query as string
    const limit = (args.limit as number) ?? 5

    if (!query || typeof query !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "query is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    const results = memoryService.archivalMemorySearch(query, limit)

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "No matching memories found",
              results: [],
            }),
          },
        ],
        isError: false,
      }
    }

    const formattedResults = results.map((r) => ({
      id: r.entry.id,
      content: r.entry.content,
      tags: r.entry.tags,
      relevance: Math.round(r.score * 100) + "%",
      importance: r.entry.importance,
      createdAt: new Date(r.entry.createdAt).toISOString(),
    }))

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              count: results.length,
              results: formattedResults,
            },
            null,
            2
          ),
        },
      ],
      isError: false,
    }
  },

  memory_stats: async (): Promise<MCPToolResult> => {
    const stats = memoryService.getStats()

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              coreMemory: {
                blocks: stats.coreMemoryBlocks,
                totalChars: stats.coreMemoryTotalChars,
                usedPercent: Math.round(stats.coreMemoryUsedPercent) + "%",
              },
              archivalMemory: {
                entries: stats.archivalMemoryEntries,
              },
              lastUpdated: stats.lastUpdated
                ? new Date(stats.lastUpdated).toISOString()
                : "never",
            },
            null,
            2
          ),
        },
      ],
      isError: false,
    }
  },
}

/**
 * Execute a memory tool by name
 * @param toolName The full tool name (e.g., "speakmcp-memory:core_memory_replace")
 * @param args The tool arguments
 * @returns The tool result or null if not a memory tool
 */
export async function executeMemoryTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolResult | null> {
  // Check if this is a memory tool
  if (!toolName.startsWith(`${MEMORY_SERVER_NAME}:`)) {
    return null
  }

  // Check if memory is enabled
  if (!memoryService.isEnabled()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error:
              "Memory system is disabled. Enable it in Settings > Memory to use memory tools.",
          }),
        },
      ],
      isError: true,
    }
  }

  // Extract the actual tool name
  const actualToolName = toolName.substring(MEMORY_SERVER_NAME.length + 1)

  // Find and execute the handler
  const handler = toolHandlers[actualToolName]
  if (!handler) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown memory tool: ${actualToolName}`,
        },
      ],
      isError: true,
    }
  }

  try {
    return await handler(args)
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing memory tool: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

/**
 * Check if a tool name is a memory tool
 */
export function isMemoryTool(toolName: string): boolean {
  return toolName.startsWith(`${MEMORY_SERVER_NAME}:`)
}

/**
 * Get memory tools if memory is enabled
 */
export function getMemoryTools(): MCPTool[] {
  if (memoryService.isEnabled()) {
    return memoryTools
  }
  return []
}
