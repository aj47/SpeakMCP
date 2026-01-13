# SpeakMCP Observability Guide

## 📊 Langfuse Integration

SpeakMCP integrates with [Langfuse](https://langfuse.com/) to provide comprehensive observability and monitoring for all LLM calls and agent operations.

> **Note**: Langfuse is an **optional dependency**. While it may be installed automatically with your dependencies, the app runs perfectly without it enabled. If you don't need observability features, no additional setup is required.

### Installation (Optional)

Langfuse is included as an optional dependency. While it may be installed automatically, the app works perfectly without it. To enable Langfuse observability features:

```bash
pnpm add langfuse
```

After installing, restart the app and the Langfuse settings will become available.

### What Gets Traced

| Component | What's Captured |
|-----------|-----------------|
| **LLM Calls** | Model name, input prompts, output responses, token usage (input/output/total) |
| **Agent Sessions** | Complete workflow from start to finish, linked to all child operations |
| **MCP Tool Calls** | Tool name, input parameters, output results, execution status |

### Setup

1. **Create a Langfuse Account**
   - Sign up at [langfuse.com](https://langfuse.com/) (free tier available)
   - Or self-host using [Langfuse's open-source deployment](https://langfuse.com/docs/deployment/self-host)

2. **Get API Keys**
   - Go to your Langfuse project settings
   - Copy your **Public Key** (`pk-lf-...`)
   - Copy your **Secret Key** (`sk-lf-...`)

3. **Configure in SpeakMCP**
   - Open Settings → General (scroll to the bottom)
   - Toggle "Enable Langfuse Tracing" on
   - Enter your Public Key
   - Enter your Secret Key
   - (Optional) Set Base URL for self-hosted instances

### Viewing Traces

Once configured, all agent interactions will appear in your Langfuse dashboard:

- **Sessions**: Conversations are grouped by session ID, allowing you to:
  - Replay entire conversation threads
  - See all agent interactions within a conversation
  - Track costs and token usage per conversation
  - Debug multi-turn conversations end-to-end

- **Traces**: Each agent session creates a trace containing:
  - User input (voice transcription or text)
  - All LLM generations with token counts
  - All MCP tool calls with inputs/outputs
  - Final output/response
  - Profile tags (e.g., `profile:General Assistant`)

- **Generations**: Individual LLM API calls showing:
  - Model used (e.g., `gpt-4o`, `gemini-2.0-flash`)
  - Input messages/prompts
  - Output response
  - Token usage metrics
  - Latency

- **Spans**: MCP tool executions showing:
  - Tool name
  - Input parameters
  - Output results
  - Execution time
  - Success/error status

### Langfuse Features Used

| Feature | SpeakMCP Mapping |
|---------|------------------|
| **Sessions** | Conversation ID - groups all agent interactions in a conversation |
| **Traces** | Agent Session ID - individual agent run with all LLM/tool calls |
| **Tags** | Profile name (e.g., `profile:General Assistant`) for filtering |
| **Generations** | Individual LLM API calls with token usage |
| **Spans** | MCP tool executions with inputs/outputs |

### Self-Hosted Langfuse

For organizations requiring data privacy:

```
Base URL: https://your-langfuse-instance.com
```

Leave the Base URL empty to use Langfuse Cloud (`https://cloud.langfuse.com`).

### Privacy Notes

- Traces include LLM inputs/outputs — be mindful of sensitive data
- API keys are stored locally in the app's config
- No data is sent to Langfuse when the integration is disabled

---

## 🔧 Debug Logging

For real-time debugging without Langfuse, use the built-in debug flags:

```bash
pnpm dev -- -d              # Enable ALL debug logging
pnpm dev -- -dl             # Debug LLM calls only
pnpm dev -- -dt             # Debug MCP tool execution only
```

See [DEBUGGING.md](./DEBUGGING.md) for the complete debugging guide.

