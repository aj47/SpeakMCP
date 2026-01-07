# Multi-Agent Architecture

SpeakMCP supports a multi-agent architecture that enables the main AI assistant to delegate tasks to specialized sub-agents. This is implemented using the **ACP (Agent Client Protocol)** - Zed's protocol for agent interaction.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SpeakMCP Main Agent                      │
│                    (User-Facing, ACP-based)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Smart Router    │
                    │ (Capability-Based)│
                    └─────────┬─────────┘
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
          ▼                                       ▼
┌─────────────────┐                     ┌─────────────────┐
│ Internal Agent  │                     │   ACP Agents    │
│  (Built-in)     │                     │ (stdio/remote)  │
└─────────────────┘                     └─────────────────┘
```

## ACP Protocol

The ACP (Agent Client Protocol) is used for agent communication via stdio or HTTP:

- **stdio**: Spawns a local process, communicates via JSON-RPC over stdin/stdout
- **remote**: Connects to an HTTP endpoint
- **internal**: Built-in agent running within the main process

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

## Module Structure

```
apps/desktop/src/main/
├── acp/                              # ACP module
│   ├── types.ts                      # ACP type definitions
│   ├── acp-registry.ts               # Agent registration and discovery
│   ├── acp-client-service.ts         # HTTP client for remote ACP agents
│   ├── acp-process-manager.ts        # Process lifecycle for stdio agents
│   ├── acp-router-tools.ts           # Built-in delegation tools
│   ├── acp-router-tool-definitions.ts  # Tool schemas
│   ├── acp-smart-router.ts           # Intelligent routing logic
│   ├── acp-background-notifier.ts    # Background polling
│   └── internal-agent.ts             # Built-in internal sub-agent
│
└── acp-service.ts                    # Legacy ACP service (stdio JSON-RPC)
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

### Tool Aliases

For flexibility, these aliases are also available:

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
  console.log(`Confidence: ${Math.round(decision.suggestedAgents[0].confidence * 100)}%`);
}
```

## Task Lifecycle

1. **Task Creation**: User request triggers delegation via `delegate_to_agent`
2. **Agent Selection**: Smart router finds matching agents based on capabilities
3. **Execution**: Task sent to agent via ACP protocol
4. **Progress Tracking**: UI receives real-time updates via event emitters
5. **Completion**: Results returned to main agent for incorporation

## Adding Custom Agents

### Local stdio Agent

1. Implement the ACP protocol (JSON-RPC over stdio)
2. Add to `acpAgents` in config with `connection.type: "stdio"`
3. Agent will be auto-discovered on startup

### Remote HTTP Agent

1. Host an ACP-compatible HTTP server
2. Add to `acpAgents` in config with `connection.type: "remote"` and `connection.baseUrl`
3. Agent will be discovered and registered on startup

## References

- [Zed ACP Specification](https://zed.dev/docs/acp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
