# MCP Server Memory Example

A comprehensive Model Context Protocol (MCP) server that demonstrates advanced memory capabilities, semantic search, sequential thinking, and zen design principles.

## Features

### 🧠 Core Memory Management
- **Basic Memory Operations**: Store, retrieve, search, and manage memories with tags and importance levels
- **Semantic Search**: AI-powered semantic search using embeddings for intelligent memory retrieval
- **Memory Analytics**: Get insights and recommendations about your memory usage patterns

### 🔗 Sequential Thinking
- **Thought Chains**: Build sequential chains of thoughts with reasoning
- **Step-by-step Processing**: Track the evolution of ideas and decision-making processes
- **Clear Mental Models**: Organize complex thinking into manageable steps

### 🧘 Zen Design Principles
- **Mindful Reflection**: Record moments of insight and reflection
- **Simplicity**: Clean, intuitive interface focused on essential functionality
- **Present Awareness**: Timestamped memories and thoughts for temporal context

### 🚀 Advanced Features
- **Mem0 Integration**: Advanced memory management with semantic understanding
- **Related Memory Discovery**: Find connections between memories automatically
- **Memory Export/Import**: Backup and restore your memory data
- **Real-time Analytics**: Monitor memory usage patterns and get recommendations

## Installation

1. **Navigate to the example directory:**
   ```bash
   cd examples/server-memory
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the TypeScript code:**
   ```bash
   npm run build
   ```

## Usage

### Starting the Server

```bash
npm start
```

The server will start and listen on stdio for MCP protocol messages.

### Development Mode

For development with auto-rebuild:
```bash
npm run dev
```

## Available Tools

### Basic Memory Operations

#### `add_memory`
Store a new memory with optional metadata.
```json
{
  "content": "Important information to remember",
  "tags": ["work", "project"],
  "importance": 8,
  "context": "Meeting with client about new requirements"
}
```

#### `search_memories`
Search through stored memories by content and tags.
```json
{
  "query": "client meeting",
  "tags": ["work"]
}
```

#### `get_all_memories`
Retrieve all stored memories, sorted by recency.

### Semantic Memory Operations

#### `semantic_search`
Perform AI-powered semantic search through memories.
```json
{
  "query": "project deadlines and timelines",
  "limit": 5
}
```

#### `get_related_memories`
Find memories semantically related to a specific memory.
```json
{
  "memoryId": "abc123"
}
```

### Sequential Thinking

#### `add_thought`
Add a step to your sequential thinking chain.
```json
{
  "thought": "We need to prioritize user experience over feature complexity",
  "reasoning": "User feedback indicates confusion with current interface"
}
```

#### `get_thought_chain`
Retrieve the complete chain of sequential thoughts.

#### `clear_thoughts`
Clear the current thought chain to start fresh.

### Zen Moments

#### `add_zen_moment`
Record a moment of mindful reflection and insight.
```json
{
  "reflection": "Paused to consider the bigger picture",
  "insight": "Sometimes stepping back reveals the path forward"
}
```

#### `get_zen_moments`
Retrieve all recorded zen moments and insights.

### Analytics & Management

#### `get_memory_insights`
Get analytics about your memory usage patterns and recommendations.

#### `export_memories`
Export all memories for backup purposes.

## Example Client Usage

Create a simple test client to interact with the server:

```javascript
// test-client.js
import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js']);

// Send a request to add a memory
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'add_memory',
    arguments: {
      content: 'Remember to review the quarterly goals',
      tags: ['work', 'planning'],
      importance: 7
    }
  }
};

server.stdin.write(JSON.stringify(request) + '\n');

server.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});
```

## Configuration

The server can be configured through environment variables:

- `MEM0_API_KEY`: API key for Mem0 service (optional)
- `MEM0_ENDPOINT`: Custom Mem0 endpoint (optional)
- `DEBUG`: Enable debug logging

## Architecture

### Memory Store
- **Basic Memory Store**: Simple in-memory storage with search capabilities
- **Enhanced Memory Store**: Advanced semantic memory with Mem0 integration
- **Dual Storage**: Both stores work together for comprehensive memory management

### Semantic Understanding
- **Embedding Generation**: Convert text to vector embeddings for semantic search
- **Similarity Calculation**: Find related memories using cosine similarity
- **Intelligent Retrieval**: Rank results by relevance and importance

### Sequential Thinking
- **Thought Chains**: Linked sequence of thoughts with reasoning
- **Temporal Tracking**: Timestamp each thought for chronological understanding
- **Clear Mental Models**: Structured approach to complex problem-solving

## Best Practices

### Memory Management
1. **Use descriptive content**: Write clear, specific memory content
2. **Tag consistently**: Develop a consistent tagging system
3. **Set importance levels**: Use 1-10 scale to prioritize memories
4. **Add context**: Include relevant context for better retrieval

### Sequential Thinking
1. **One thought per step**: Keep each thought focused and atomic
2. **Clear reasoning**: Explain the logic behind each thought
3. **Build incrementally**: Let ideas develop naturally through the chain
4. **Review regularly**: Use `get_thought_chain` to review your thinking process

### Zen Practices
1. **Regular reflection**: Take time to record insights and reflections
2. **Present awareness**: Focus on current thoughts and feelings
3. **Simple language**: Use clear, simple language in reflections
4. **Pattern recognition**: Look for patterns in your zen moments

## Troubleshooting

### Common Issues

1. **Server won't start**: Ensure TypeScript is compiled (`npm run build`)
2. **Memory not found**: Check memory ID and ensure it exists
3. **Semantic search not working**: Verify embeddings are generated correctly
4. **Performance issues**: Consider limiting search results and optimizing queries

### Debug Mode

Enable debug logging:
```bash
DEBUG=* npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Related

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Mem0 Documentation](https://docs.mem0.ai/)

---

*This example demonstrates the power of combining memory management, semantic understanding, sequential thinking, and mindful design in an MCP server.*
