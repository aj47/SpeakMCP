# Multi-Agent Architecture

SpeakMCP supports a multi-agent architecture that enables the main AI assistant to delegate tasks to specialized sub-agents. This is implemented using two industry-standard protocols:

- **ACP (Agent Client Protocol)** - Zed's protocol for user-to-agent interaction
- **A2A (Agent-to-Agent Protocol)** - Google's protocol for agent-to-agent delegation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SpeakMCP Main Agent                      │
│                    (User-Facing, ACP-based)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Smart Router    │
                    │ (Unified Routing) │
                    └─────────┬─────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Internal Agent  │ │   ACP Agents    │ │   A2A Agents    │
│  (Built-in)     │ │ (stdio/remote)  │ │ (HTTP/JSON-RPC) │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Protocols

### ACP (Agent Client Protocol)

Used for local agent communication via stdio or HTTP:

- **stdio**: Spawns a local process, communicates via JSON-RPC over stdin/stdout
- **remote**: Connects to an HTTP endpoint

Configuration in `config.json`:
```json
{
  "acpAgents": [
    {
      "name": "coding-agent",
      "displayName": "Coding Assistant",
      "description": "Specialized for code generation and debugging",
      "capabilities": ["coding", "debugging"],
      "connection": {
        "type": "stdio",
        "command": "claude-code-acp",
        "args": ["--acp"]
      }
    }
  ]
}
```

### A2A (Agent-to-Agent Protocol)

Used for remote agent communication via HTTP/JSON-RPC:

- Agents expose `/.well-known/agent-card.json` for discovery
- Communication via JSON-RPC methods: `message/send`, `tasks/get`, `tasks/cancel`
- Supports streaming and push notifications via webhooks

Configuration in `config.json`:
```json
{
  "a2aConfig": {
    "agentUrls": [
      "https://research-agent.example.com",
      "https://analysis-agent.example.com"
    ],
    "enableWebhooks": true,
    "webhookPort": 0
  }
}
```

## Module Structure

```
apps/desktop/src/main/
├── acp/                          # ACP module (user-to-agent)
│   ├── types.ts                  # ACP type definitions
│   ├── acp-registry.ts           # Agent registration and discovery
│   ├── acp-client-service.ts     # HTTP client for remote ACP agents
│   ├── acp-process-manager.ts    # Process lifecycle for stdio agents
│   ├── acp-router-tools.ts       # Built-in delegation tools
│   ├── acp-router-tool-definitions.ts  # Tool schemas
│   ├── acp-smart-router.ts       # Intelligent routing logic
│   ├── acp-background-notifier.ts      # Background polling
│   └── internal-agent.ts         # Built-in internal sub-agent
│
├── a2a/                          # A2A module (agent-to-agent)
│   ├── types.ts                  # A2A protocol types
│   ├── agent-registry.ts         # Agent discovery via AgentCards
│   ├── a2a-client.ts             # HTTP/JSON-RPC client
│   ├── task-manager.ts           # Task lifecycle management
│   ├── webhook-server.ts         # Push notification receiver
│   └── index.ts                  # Module exports and initialization
│
└── acp-service.ts                # Legacy ACP service (stdio JSON-RPC)
```

## Delegation Tools

The main agent has access to these built-in tools for delegation:

| Tool | Description |
|------|-------------|
| `list_available_agents` | List all registered agents with their capabilities |
| `delegate_to_agent` | Send a task to a specific agent |
| `check_agent_status` | Check the status of a running task |
| `spawn_agent` | Start a stopped stdio agent |
| `stop_agent` | Stop a running agent |
| `cancel_agent_run` | Cancel a running task |

### A2A-Aligned Aliases

For compatibility with A2A terminology, these aliases are also available:

| Alias | Maps To |
|-------|---------|
| `send_to_agent` | `delegate_to_agent` |
| `get_task_status` | `check_agent_status` |
| `cancel_task` | `cancel_agent_run` |

## Smart Router

The smart router analyzes tasks and suggests appropriate agents:

```typescript
import { acpSmartRouter } from './acp-smart-router';

// Analyze a task and get routing suggestions
const decision = acpSmartRouter.suggestUnifiedDelegation(
  "Research the latest React 19 features and write a summary"
);

if (decision.shouldDelegate) {
  console.log(`Best match: ${decision.suggestedAgents[0].agentName}`);
  console.log(`Protocol: ${decision.suggestedAgents[0].isA2A ? 'A2A' : 'ACP'}`);
}
```

## Task Lifecycle

1. **Task Creation**: User request triggers delegation via `delegate_to_agent`
2. **Agent Selection**: Smart router finds matching agents (ACP or A2A)
3. **Execution**: Task sent to agent via appropriate protocol
4. **Progress Tracking**: UI receives real-time updates via event emitters
5. **Completion**: Results returned to main agent for incorporation

## Adding Custom Agents

### Local ACP Agent

1. Implement the ACP protocol (JSON-RPC over stdio)
2. Add to `acpAgents` in config
3. Agent will be auto-discovered on startup

### Remote A2A Agent

1. Host an A2A-compatible server with `/.well-known/agent-card.json`
2. Add the URL to `a2aConfig.agentUrls`
3. Agent will be discovered and registered on startup

## References

- [Zed ACP Specification](https://zed.dev/docs/acp)
- [Google A2A Protocol](https://github.com/google/a2a-protocol)
- [Model Context Protocol](https://modelcontextprotocol.io/)
