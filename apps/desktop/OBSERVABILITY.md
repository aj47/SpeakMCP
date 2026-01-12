# SpeakMCP Observability Guide

## 📊 Langfuse Integration

SpeakMCP integrates with [Langfuse](https://langfuse.com/) to provide comprehensive observability and monitoring for all LLM calls and agent operations.

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
   - Open Settings → Langfuse
   - Toggle "Enable Langfuse Tracing" on
   - Enter your Public Key
   - Enter your Secret Key
   - (Optional) Set Base URL for self-hosted instances

### Viewing Traces

Once configured, all agent interactions will appear in your Langfuse dashboard:

- **Traces**: Each agent session creates a trace containing:
  - User input (voice transcription or text)
  - All LLM generations with token counts
  - All MCP tool calls with inputs/outputs
  - Final output/response

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

