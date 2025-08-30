#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { EnhancedMemoryStore, type Mem0Memory } from './mem0-integration.js';

// Memory interfaces
interface Memory {
  id: string;
  content: string;
  timestamp: Date;
  tags: string[];
  importance: number; // 1-10 scale
  context?: string;
}

interface ThoughtStep {
  step: number;
  thought: string;
  reasoning: string;
  timestamp: Date;
}

interface ZenMoment {
  id: string;
  reflection: string;
  insight: string;
  timestamp: Date;
}

// In-memory storage (in production, use persistent storage)
class MemoryStore {
  private memories: Map<string, Memory> = new Map();
  private thoughts: ThoughtStep[] = [];
  private zenMoments: Map<string, ZenMoment> = new Map();

  // Memory operations
  addMemory(content: string, tags: string[] = [], importance: number = 5, context?: string): Memory {
    const memory: Memory = {
      id: this.generateId(),
      content,
      tags,
      importance,
      context,
      timestamp: new Date(),
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  getMemory(id: string): Memory | undefined {
    return this.memories.get(id);
  }

  searchMemories(query: string, tags?: string[]): Memory[] {
    const results: Memory[] = [];
    for (const memory of this.memories.values()) {
      const contentMatch = memory.content.toLowerCase().includes(query.toLowerCase());
      const tagMatch = !tags || tags.some(tag => memory.tags.includes(tag));
      if (contentMatch && tagMatch) {
        results.push(memory);
      }
    }
    return results.sort((a, b) => b.importance - a.importance);
  }

  getAllMemories(): Memory[] {
    return Array.from(this.memories.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Sequential thinking operations
  addThought(thought: string, reasoning: string): ThoughtStep {
    const step: ThoughtStep = {
      step: this.thoughts.length + 1,
      thought,
      reasoning,
      timestamp: new Date(),
    };
    this.thoughts.push(step);
    return step;
  }

  getThoughtChain(): ThoughtStep[] {
    return [...this.thoughts];
  }

  clearThoughts(): void {
    this.thoughts = [];
  }

  // Zen operations
  addZenMoment(reflection: string, insight: string): ZenMoment {
    const zenMoment: ZenMoment = {
      id: this.generateId(),
      reflection,
      insight,
      timestamp: new Date(),
    };
    this.zenMoments.set(zenMoment.id, zenMoment);
    return zenMoment;
  }

  getZenMoments(): ZenMoment[] {
    return Array.from(this.zenMoments.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

// Initialize memory stores
const memoryStore = new MemoryStore();
const enhancedMemoryStore = new EnhancedMemoryStore();

// Define tool schemas
const AddMemorySchema = z.object({
  content: z.string().describe('The content to remember'),
  tags: z.array(z.string()).optional().describe('Tags to categorize the memory'),
  importance: z.number().min(1).max(10).optional().describe('Importance level (1-10)'),
  context: z.string().optional().describe('Additional context for the memory'),
});

const SearchMemorySchema = z.object({
  query: z.string().describe('Search query for memories'),
  tags: z.array(z.string()).optional().describe('Filter by specific tags'),
});

const AddThoughtSchema = z.object({
  thought: z.string().describe('The thought or idea'),
  reasoning: z.string().describe('The reasoning behind this thought'),
});

const AddZenMomentSchema = z.object({
  reflection: z.string().describe('A mindful reflection'),
  insight: z.string().describe('The insight gained from this reflection'),
});

const SemanticSearchSchema = z.object({
  query: z.string().describe('Semantic search query'),
  limit: z.number().optional().describe('Maximum number of results (default: 10)'),
});

const GetRelatedMemoriesSchema = z.object({
  memoryId: z.string().describe('ID of the memory to find related memories for'),
});

// Define tools with proper JSON Schema format
const tools: Tool[] = [
  {
    name: 'add_memory',
    description: 'Store a new memory with optional tags, importance, and context',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content to remember' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to categorize the memory' },
        importance: { type: 'number', minimum: 1, maximum: 10, description: 'Importance level (1-10)' },
        context: { type: 'string', description: 'Additional context for the memory' }
      },
      required: ['content']
    },
  },
  {
    name: 'search_memories',
    description: 'Search through stored memories by content and tags',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for memories' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by specific tags' }
      },
      required: ['query']
    },
  },
  {
    name: 'get_all_memories',
    description: 'Retrieve all stored memories, sorted by recency',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
  {
    name: 'add_thought',
    description: 'Add a step to the sequential thinking chain',
    inputSchema: {
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'The thought or idea' },
        reasoning: { type: 'string', description: 'The reasoning behind this thought' }
      },
      required: ['thought', 'reasoning']
    },
  },
  {
    name: 'get_thought_chain',
    description: 'Retrieve the complete chain of sequential thoughts',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
  {
    name: 'clear_thoughts',
    description: 'Clear the current thought chain to start fresh',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
  {
    name: 'add_zen_moment',
    description: 'Record a moment of mindful reflection and insight',
    inputSchema: {
      type: 'object',
      properties: {
        reflection: { type: 'string', description: 'A mindful reflection' },
        insight: { type: 'string', description: 'The insight gained from this reflection' }
      },
      required: ['reflection', 'insight']
    },
  },
  {
    name: 'get_zen_moments',
    description: 'Retrieve all zen moments and insights',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
  {
    name: 'semantic_search',
    description: 'Perform semantic search through memories using AI embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic search query' },
        limit: { type: 'number', description: 'Maximum number of results (default: 10)' }
      },
      required: ['query']
    },
  },
  {
    name: 'get_related_memories',
    description: 'Find memories related to a specific memory using semantic similarity',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: 'ID of the memory to find related memories for' }
      },
      required: ['memoryId']
    },
  },
  {
    name: 'get_memory_insights',
    description: 'Get analytics and insights about stored memories',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
  {
    name: 'export_memories',
    description: 'Export all memories for backup purposes',
    inputSchema: {
      type: 'object',
      properties: {}
    },
  },
];

// Create server
const server = new Server(
  {
    name: 'memory-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'add_memory': {
        const { content, tags = [], importance = 5, context } = AddMemorySchema.parse(args);
        const memory = memoryStore.addMemory(content, tags, importance, context);
        return {
          content: [
            {
              type: 'text',
              text: `Memory stored successfully!\nID: ${memory.id}\nContent: ${memory.content}\nTags: ${memory.tags.join(', ')}\nImportance: ${memory.importance}/10`,
            },
          ],
        };
      }

      case 'search_memories': {
        const { query, tags } = SearchMemorySchema.parse(args);
        const memories = memoryStore.searchMemories(query, tags);
        const results = memories.map(m => 
          `ID: ${m.id}\nContent: ${m.content}\nTags: ${m.tags.join(', ')}\nImportance: ${m.importance}/10\nTime: ${m.timestamp.toISOString()}`
        ).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: memories.length > 0 ? `Found ${memories.length} memories:\n\n${results}` : 'No memories found matching your query.',
            },
          ],
        };
      }

      case 'get_all_memories': {
        const memories = memoryStore.getAllMemories();
        const results = memories.map(m => 
          `ID: ${m.id}\nContent: ${m.content}\nTags: ${m.tags.join(', ')}\nImportance: ${m.importance}/10\nTime: ${m.timestamp.toISOString()}`
        ).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: memories.length > 0 ? `All memories (${memories.length} total):\n\n${results}` : 'No memories stored yet.',
            },
          ],
        };
      }

      case 'add_thought': {
        const { thought, reasoning } = AddThoughtSchema.parse(args);
        const step = memoryStore.addThought(thought, reasoning);
        return {
          content: [
            {
              type: 'text',
              text: `Thought step ${step.step} added:\nThought: ${step.thought}\nReasoning: ${step.reasoning}`,
            },
          ],
        };
      }

      case 'get_thought_chain': {
        const thoughts = memoryStore.getThoughtChain();
        const chain = thoughts.map(t => 
          `Step ${t.step}: ${t.thought}\nReasoning: ${t.reasoning}\nTime: ${t.timestamp.toISOString()}`
        ).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: thoughts.length > 0 ? `Sequential thought chain:\n\n${chain}` : 'No thoughts in the chain yet.',
            },
          ],
        };
      }

      case 'clear_thoughts': {
        memoryStore.clearThoughts();
        return {
          content: [
            {
              type: 'text',
              text: 'Thought chain cleared. Ready for fresh thinking.',
            },
          ],
        };
      }

      case 'add_zen_moment': {
        const { reflection, insight } = AddZenMomentSchema.parse(args);
        const zenMoment = memoryStore.addZenMoment(reflection, insight);
        return {
          content: [
            {
              type: 'text',
              text: `Zen moment recorded:\nReflection: ${zenMoment.reflection}\nInsight: ${zenMoment.insight}`,
            },
          ],
        };
      }

      case 'get_zen_moments': {
        const zenMoments = memoryStore.getZenMoments();
        const moments = zenMoments.map(z =>
          `Reflection: ${z.reflection}\nInsight: ${z.insight}\nTime: ${z.timestamp.toISOString()}`
        ).join('\n\n---\n\n');
        return {
          content: [
            {
              type: 'text',
              text: zenMoments.length > 0 ? `Zen moments and insights:\n\n${moments}` : 'No zen moments recorded yet.',
            },
          ],
        };
      }

      case 'semantic_search': {
        const { query, limit = 10 } = SemanticSearchSchema.parse(args);
        const memories = await enhancedMemoryStore.searchSemanticMemories(query, limit);
        const results = memories.map(m =>
          `ID: ${m.id}\nContent: ${m.content}\nSimilarity: ${(m.similarity || 0).toFixed(3)}\nTags: ${m.metadata.tags?.join(', ') || 'none'}\nTime: ${m.metadata.timestamp}`
        ).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: memories.length > 0 ? `Found ${memories.length} semantically related memories:\n\n${results}` : 'No semantically related memories found.',
            },
          ],
        };
      }

      case 'get_related_memories': {
        const { memoryId } = GetRelatedMemoriesSchema.parse(args);
        const relatedMemories = await enhancedMemoryStore.getRelatedMemories(memoryId);
        const results = relatedMemories.map(m =>
          `ID: ${m.id}\nContent: ${m.content}\nSimilarity: ${(m.similarity || 0).toFixed(3)}\nTime: ${m.metadata.timestamp}`
        ).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: relatedMemories.length > 0 ? `Related memories:\n\n${results}` : 'No related memories found.',
            },
          ],
        };
      }

      case 'get_memory_insights': {
        const insights = enhancedMemoryStore.getMemoryInsights();
        const statsText = `Total memories: ${insights.stats.total}\nAverage content length: ${insights.stats.averageContentLength.toFixed(1)} characters\nMemory types: ${Object.entries(insights.stats.byType).map(([type, count]) => `${type}: ${count}`).join(', ')}`;
        const recommendationsText = insights.recommendations.length > 0 ? `\n\nRecommendations:\n${insights.recommendations.map(r => `• ${r}`).join('\n')}` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Memory Analytics:\n\n${statsText}${recommendationsText}`,
            },
          ],
        };
      }

      case 'export_memories': {
        const memories = enhancedMemoryStore.exportMemories();
        const exportData = JSON.stringify(memories, null, 2);
        return {
          content: [
            {
              type: 'text',
              text: `Exported ${memories.length} memories:\n\n${exportData}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Memory MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
