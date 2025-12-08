/**
 * Letta-style Memory Types for SpeakMCP
 *
 * Based on the MemGPT paper (arXiv:2310.08560) and Letta framework concepts:
 * - Core Memory: In-context memory blocks that persist across interactions
 * - Archival Memory: Long-term storage for facts and experiences (vector DB backed)
 * - Recall Memory: Conversation history search capabilities
 *
 * Memory Hierarchy:
 * - Core Memory (RAM-like): Always in context, limited size, self-editable
 * - Archival Memory (Disk-like): Unlimited size, searchable, for long-term storage
 */

/**
 * A memory block represents a structured section of the agent's context window.
 * Memory blocks persist across all interactions and are always visible to the agent.
 */
export interface MemoryBlock {
  /** Unique identifier for the block */
  id: string

  /** Label/name for the block (e.g., "human", "persona", "task") */
  label: string

  /** Description of what this block is for (guides the agent) */
  description: string

  /** The actual content of the memory block */
  value: string

  /** Maximum character limit for this block */
  limit: number

  /** Whether the agent can modify this block */
  readOnly: boolean

  /** Timestamp of last update */
  updatedAt: number

  /** Timestamp of creation */
  createdAt: number
}

/**
 * Default memory block configurations following Letta conventions
 */
export const DEFAULT_MEMORY_BLOCKS: Omit<MemoryBlock, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    label: "persona",
    description: "Your identity, personality traits, communication style, and behavioral guidelines. Update this as you learn about your own preferences and working style.",
    value: "I am a helpful AI assistant integrated with SpeakMCP. I help users accomplish tasks using available MCP tools. I am thorough, precise, and maintain context across conversations.",
    limit: 2000,
    readOnly: false,
  },
  {
    label: "human",
    description: "Information about the user you are interacting with. Store their name, preferences, relevant context, and important details you learn during conversations.",
    value: "",
    limit: 2000,
    readOnly: false,
  },
  {
    label: "task_context",
    description: "Current task context, goals, and relevant information for the ongoing work. Update as tasks progress.",
    value: "",
    limit: 1000,
    readOnly: false,
  },
]

/**
 * An archival memory entry - stored in long-term vector storage
 */
export interface ArchivalMemoryEntry {
  /** Unique identifier */
  id: string

  /** The content/text of the memory */
  content: string

  /** Keywords/tags for this memory */
  tags: string[]

  /** Source of the memory (conversation ID, tool result, etc.) */
  source: string

  /** Importance score (0-1) */
  importance: number

  /** Timestamp when this was stored */
  createdAt: number

  /** Optional embedding vector for similarity search */
  embedding?: number[]
}

/**
 * Configuration for the memory system
 */
export interface MemoryConfig {
  /** Whether the memory system is enabled */
  enabled: boolean

  /** Whether to auto-save memory after each session */
  autoSave: boolean

  /** Maximum number of archival memories to keep */
  maxArchivalMemories: number

  /** Whether to include memory in system prompt */
  includeInSystemPrompt: boolean

  /** Custom memory blocks to use (overrides defaults) */
  customBlocks?: Omit<MemoryBlock, 'id' | 'createdAt' | 'updatedAt'>[]
}

/**
 * Default memory configuration
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  autoSave: true,
  maxArchivalMemories: 1000,
  includeInSystemPrompt: true,
}

/**
 * The complete memory state for an agent
 */
export interface AgentMemory {
  /** Unique identifier for this memory instance */
  id: string

  /** Core memory blocks (in-context) */
  coreMemory: MemoryBlock[]

  /** Archival memory entries (out-of-context, searchable) */
  archivalMemory: ArchivalMemoryEntry[]

  /** Memory configuration */
  config: MemoryConfig

  /** Version for migration purposes */
  version: number

  /** Timestamp of last update */
  updatedAt: number

  /** Timestamp of creation */
  createdAt: number
}

/**
 * Result from archival memory search
 */
export interface ArchivalSearchResult {
  entry: ArchivalMemoryEntry
  score: number // Relevance score (0-1)
}

/**
 * Memory operation types for tracking changes
 */
export type MemoryOperationType =
  | 'core_memory_replace'
  | 'core_memory_append'
  | 'archival_memory_insert'
  | 'archival_memory_delete'

/**
 * A record of a memory operation
 */
export interface MemoryOperation {
  type: MemoryOperationType
  timestamp: number
  blockLabel?: string // For core memory operations
  entryId?: string // For archival memory operations
  oldValue?: string
  newValue?: string
}

/**
 * Statistics about memory usage
 */
export interface MemoryStats {
  coreMemoryBlocks: number
  coreMemoryTotalChars: number
  coreMemoryUsedPercent: number
  archivalMemoryEntries: number
  lastUpdated: number
}
