#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

class MCPClient {
  constructor() {
    this.server = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
  }

  async start() {
    console.log('🚀 Starting MCP Memory Server...');
    
    this.server = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          // Ignore non-JSON output (like server startup messages)
        }
      }
    });

    this.server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    this.server.on('close', (code) => {
      console.log(`Server exited with code ${code}`);
    });

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ Server started successfully!\n');
  }

  handleResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);
      
      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    }
  }

  async sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      
      this.server.stdin.write(JSON.stringify(request) + '\n');
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  async callTool(name, args = {}) {
    try {
      const result = await this.sendRequest('tools/call', {
        name,
        arguments: args
      });
      return result;
    } catch (error) {
      console.error(`Error calling tool ${name}:`, error.message);
      return null;
    }
  }

  async listTools() {
    try {
      const result = await this.sendRequest('tools/list');
      return result;
    } catch (error) {
      console.error('Error listing tools:', error.message);
      return null;
    }
  }

  stop() {
    if (this.server) {
      this.server.kill();
    }
  }
}

// Demo functions
async function demonstrateBasicMemory(client) {
  console.log('📝 === Basic Memory Operations ===\n');

  // Add some memories
  console.log('Adding memories...');
  await client.callTool('add_memory', {
    content: 'Remember to review the quarterly goals next week',
    tags: ['work', 'planning'],
    importance: 8,
    context: 'Q4 planning meeting'
  });

  await client.callTool('add_memory', {
    content: 'Great coffee shop on Main Street - excellent espresso',
    tags: ['personal', 'food'],
    importance: 5
  });

  await client.callTool('add_memory', {
    content: 'Client feedback: need better mobile responsiveness',
    tags: ['work', 'feedback', 'mobile'],
    importance: 9,
    context: 'User testing session'
  });

  // Search memories
  console.log('\nSearching for work-related memories...');
  const workMemories = await client.callTool('search_memories', {
    query: 'work',
    tags: ['work']
  });
  
  if (workMemories?.content?.[0]?.text) {
    console.log(workMemories.content[0].text);
  }

  // Get all memories
  console.log('\nRetrieving all memories...');
  const allMemories = await client.callTool('get_all_memories');
  if (allMemories?.content?.[0]?.text) {
    console.log(allMemories.content[0].text);
  }
}

async function demonstrateSequentialThinking(client) {
  console.log('\n🧠 === Sequential Thinking ===\n');

  // Build a thought chain
  console.log('Building a thought chain about project planning...');
  
  await client.callTool('add_thought', {
    thought: 'We need to improve our mobile app user experience',
    reasoning: 'Recent user feedback indicates frustration with mobile interface'
  });

  await client.callTool('add_thought', {
    thought: 'Focus on the most critical user journeys first',
    reasoning: 'Limited development resources require prioritization'
  });

  await client.callTool('add_thought', {
    thought: 'Start with the login and onboarding flow',
    reasoning: 'These are the first touchpoints and have highest impact on user retention'
  });

  await client.callTool('add_thought', {
    thought: 'Conduct A/B testing on the new designs',
    reasoning: 'Data-driven approach will validate our assumptions'
  });

  // Get the thought chain
  console.log('\nRetrieving thought chain...');
  const thoughtChain = await client.callTool('get_thought_chain');
  if (thoughtChain?.content?.[0]?.text) {
    console.log(thoughtChain.content[0].text);
  }
}

async function demonstrateZenMoments(client) {
  console.log('\n🧘 === Zen Moments ===\n');

  // Add zen moments
  console.log('Recording zen moments...');
  
  await client.callTool('add_zen_moment', {
    reflection: 'Took a moment to breathe and center myself before the big presentation',
    insight: 'Calm presence leads to clearer communication and better outcomes'
  });

  await client.callTool('add_zen_moment', {
    reflection: 'Noticed feeling overwhelmed by the project timeline',
    insight: 'Breaking large tasks into smaller steps makes progress feel achievable'
  });

  await client.callTool('add_zen_moment', {
    reflection: 'Paused to appreciate the team\'s collaborative effort',
    insight: 'Gratitude enhances team dynamics and personal satisfaction'
  });

  // Get zen moments
  console.log('\nRetrieving zen moments...');
  const zenMoments = await client.callTool('get_zen_moments');
  if (zenMoments?.content?.[0]?.text) {
    console.log(zenMoments.content[0].text);
  }
}

async function demonstrateSemanticFeatures(client) {
  console.log('\n🔍 === Semantic Memory Features ===\n');

  // Semantic search
  console.log('Performing semantic search...');
  const semanticResults = await client.callTool('semantic_search', {
    query: 'user experience and interface design',
    limit: 3
  });
  
  if (semanticResults?.content?.[0]?.text) {
    console.log(semanticResults.content[0].text);
  }

  // Get memory insights
  console.log('\nGetting memory insights...');
  const insights = await client.callTool('get_memory_insights');
  if (insights?.content?.[0]?.text) {
    console.log(insights.content[0].text);
  }
}

async function demonstrateTools(client) {
  console.log('\n🛠️  === Available Tools ===\n');
  
  const tools = await client.listTools();
  if (tools?.tools) {
    console.log(`Found ${tools.tools.length} available tools:\n`);
    tools.tools.forEach(tool => {
      console.log(`• ${tool.name}: ${tool.description}`);
    });
  }
}

// Main demo function
async function runDemo() {
  const client = new MCPClient();
  
  try {
    await client.start();
    
    // Run demonstrations
    await demonstrateTools(client);
    await demonstrateBasicMemory(client);
    await demonstrateSequentialThinking(client);
    await demonstrateZenMoments(client);
    await demonstrateSemanticFeatures(client);
    
    console.log('\n✨ Demo completed successfully!');
    console.log('\nTry running individual commands:');
    console.log('• node test-client.js --interactive');
    console.log('• npm test');
    
  } catch (error) {
    console.error('Demo failed:', error);
  } finally {
    client.stop();
  }
}

// Interactive mode
async function runInteractive() {
  const client = new MCPClient();
  await client.start();
  
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🎯 Interactive MCP Memory Server');
  console.log('Type "help" for available commands, "quit" to exit\n');

  const askQuestion = () => {
    rl.question('> ', async (input) => {
      const [command, ...args] = input.trim().split(' ');
      
      switch (command) {
        case 'help':
          console.log('Available commands:');
          console.log('• add <content> - Add a memory');
          console.log('• search <query> - Search memories');
          console.log('• think <thought> <reasoning> - Add a thought');
          console.log('• zen <reflection> <insight> - Add zen moment');
          console.log('• list - List all tools');
          console.log('• quit - Exit');
          break;
          
        case 'add':
          const content = args.join(' ');
          if (content) {
            await client.callTool('add_memory', { content });
            console.log('✅ Memory added');
          } else {
            console.log('❌ Please provide content');
          }
          break;
          
        case 'search':
          const query = args.join(' ');
          if (query) {
            const result = await client.callTool('search_memories', { query });
            if (result?.content?.[0]?.text) {
              console.log(result.content[0].text);
            }
          } else {
            console.log('❌ Please provide search query');
          }
          break;
          
        case 'quit':
          console.log('👋 Goodbye!');
          client.stop();
          rl.close();
          return;
          
        default:
          console.log('❌ Unknown command. Type "help" for available commands.');
      }
      
      askQuestion();
    });
  };

  askQuestion();
}

// Check command line arguments
if (process.argv.includes('--interactive')) {
  runInteractive();
} else {
  runDemo();
}
