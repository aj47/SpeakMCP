# Parallel Agent System

## Overview

The Parallel Agent System allows SpeakMCP to run multiple AI agents concurrently, each with their own conversation history and isolated execution environment. This enables complex multi-threaded workflows, parallel task execution, and enhanced productivity.

## Architecture

### Core Components

1. **AgentPoolService** (`src/main/agent-pool-service.ts`)
   - Manages the lifecycle of multiple agent instances
   - Handles resource allocation and cleanup
   - Provides statistics and monitoring capabilities
   - Enforces concurrency limits and resource constraints

2. **EnhancedConversationService** (`src/main/enhanced-conversation-service.ts`)
   - Extends the base conversation service with agent metadata
   - Provides conversation locking for concurrent access
   - Manages agent-specific conversation indexing
   - Handles parent-child conversation relationships

3. **Agent Pool Dashboard** (`src/renderer/src/components/agent-pool-dashboard.tsx`)
   - Real-time monitoring of all agent instances
   - Resource usage visualization
   - Agent lifecycle management controls
   - Performance metrics and analytics

4. **Create Agent Dialog** (`src/renderer/src/components/create-agent-dialog.tsx`)
   - Template-based agent creation
   - Custom prompt configuration
   - Resource limit settings
   - Auto-start options

## Key Features

### Independent Execution
- Each agent runs in its own isolated environment
- Separate conversation histories and context
- Independent tool access and MCP server connections
- Isolated process management and cleanup

### Concurrent Processing
- Multiple agents can run simultaneously
- Configurable concurrency limits (default: 5 agents)
- Resource-aware scheduling and throttling
- Automatic load balancing

### Resource Management
- Process tracking and cleanup
- Memory usage monitoring
- Conversation storage optimization
- Automatic garbage collection of completed agents

### Real-time Monitoring
- Live agent status updates
- Progress tracking with iteration counts
- Performance metrics and completion times
- Error tracking and diagnostics

## Usage

### Creating Agents

1. **Via UI Dashboard**
   - Navigate to the Agent Pool page
   - Click "Create Agent"
   - Select a template or use custom prompt
   - Configure max iterations and options
   - Choose to auto-start or create idle

2. **Via API**
   ```typescript
   const agentId = await tipcClient.createAgent("Your prompt here", {
     maxIterations: 15,
     metadata: { customName: "Research Agent" }
   })
   
   await tipcClient.startAgent(agentId)
   ```

### Agent Templates

#### General Assistant
- **Purpose**: Versatile agent for general tasks
- **Max Iterations**: 10
- **Best For**: General questions, simple tasks

#### Research Agent
- **Purpose**: Information gathering and research
- **Max Iterations**: 15
- **Best For**: Web research, data collection, analysis

#### Code Assistant
- **Purpose**: Programming and development tasks
- **Max Iterations**: 20
- **Best For**: Code review, debugging, development

#### Data Analyzer
- **Purpose**: Data processing and analysis
- **Max Iterations**: 12
- **Best For**: Data visualization, statistical analysis

### Managing Agents

#### Individual Agent Control
- **Start**: Begin processing for idle agents
- **Stop**: Halt processing and cleanup resources
- **View**: Navigate to agent's conversation thread
- **Monitor**: Track progress and performance

#### Bulk Operations
- **Stop All**: Emergency halt for all active agents
- **Cleanup**: Remove completed agents older than 30 minutes
- **Resource Limits**: Adjust maximum concurrent agents

## Configuration

### System Limits
```typescript
// Maximum concurrent agents (adjustable 1-20)
agentPoolService.setMaxConcurrentAgents(5)

// Cleanup interval for completed agents
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// Agent completion timeout
const AGENT_TIMEOUT = 30 * 60 * 1000 // 30 minutes
```

### Resource Thresholds
- **Process Limit**: 50 concurrent processes
- **Memory Monitoring**: Automatic cleanup when limits approached
- **Conversation Storage**: Optimized indexing for large numbers of conversations

## API Reference

### Agent Pool Service

#### Core Methods
- `createAgent(prompt, options)` - Create new agent instance
- `startAgent(agentId)` - Begin agent processing
- `stopAgent(agentId)` - Halt specific agent
- `getAgent(agentId)` - Retrieve agent details
- `getAllAgents()` - Get all agent instances
- `getStats()` - Get pool statistics

#### Management Methods
- `stopAllAgents()` - Emergency stop all agents
- `setMaxConcurrentAgents(max)` - Configure limits
- `getActiveAgentCount()` - Current active count
- `cleanupCompletedAgents()` - Manual cleanup

### Enhanced Conversation Service

#### Agent-Specific Methods
- `createAgentConversation(prompt, agentId, options)` - Create agent conversation
- `updateAgentStatus(conversationId, agentId, status)` - Update agent metadata
- `getAgentConversations()` - Get all agent conversations
- `getActiveAgentConversations()` - Get active agent conversations

#### Locking Methods
- `acquireLock(conversationId, agentId)` - Acquire conversation lock
- `releaseLock(conversationId, agentId)` - Release conversation lock

## Best Practices

### Agent Design
1. **Clear Objectives**: Define specific, measurable goals for each agent
2. **Appropriate Scope**: Match iteration limits to task complexity
3. **Resource Awareness**: Consider system resources when creating multiple agents
4. **Error Handling**: Design agents to handle failures gracefully

### Resource Management
1. **Monitor Usage**: Regularly check resource consumption
2. **Cleanup Completed**: Remove finished agents to free resources
3. **Limit Concurrency**: Don't exceed system capabilities
4. **Emergency Stops**: Use stop-all for system protection

### Performance Optimization
1. **Template Selection**: Use appropriate templates for tasks
2. **Iteration Tuning**: Optimize max iterations for efficiency
3. **Batch Operations**: Group similar tasks when possible
4. **Resource Scheduling**: Stagger agent creation for better performance

## Troubleshooting

### Common Issues

#### "Maximum concurrent agents limit reached"
- **Cause**: Too many active agents
- **Solution**: Stop some agents or increase limit
- **Prevention**: Monitor active count before creating agents

#### "Cannot acquire lock for conversation"
- **Cause**: Conversation locked by another agent
- **Solution**: Wait for lock release or check agent status
- **Prevention**: Avoid multiple agents on same conversation

#### High resource usage
- **Cause**: Too many concurrent processes
- **Solution**: Reduce concurrent agents or stop some agents
- **Prevention**: Monitor resource usage dashboard

### Debugging

#### Agent Status Tracking
```typescript
// Check agent status
const agent = await tipcClient.getAgent(agentId)
console.log(`Agent ${agentId} status: ${agent.status}`)

// Monitor all agents
const stats = await tipcClient.getAgentPoolStats()
console.log(`Active: ${stats.activeAgents}, Total: ${stats.totalAgents}`)
```

#### Resource Monitoring
```typescript
// Check resource usage
const stats = await tipcClient.getAgentPoolStats()
console.log(`Processes: ${stats.totalResourceUsage.processes}`)
console.log(`Conversations: ${stats.totalResourceUsage.conversations}`)
```

## Future Enhancements

### Planned Features
1. **Agent Collaboration**: Inter-agent communication and coordination
2. **Workflow Orchestration**: Complex multi-agent workflows
3. **Resource Prediction**: Predictive resource allocation
4. **Advanced Templates**: Domain-specific agent templates
5. **Performance Analytics**: Detailed performance insights

### Integration Opportunities
1. **External APIs**: Integration with external services
2. **Database Connections**: Direct database access for agents
3. **File System Operations**: Enhanced file manipulation capabilities
4. **Network Operations**: Advanced networking and communication tools

## Security Considerations

### Isolation
- Each agent runs in isolated environment
- No cross-agent data sharing without explicit design
- Process-level isolation for security

### Resource Limits
- Configurable resource constraints
- Automatic cleanup prevents resource exhaustion
- Emergency stop mechanisms for system protection

### Access Control
- Agent creation requires appropriate permissions
- Conversation access controlled by agent ownership
- Administrative controls for system management
