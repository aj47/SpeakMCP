# Continuous-Claude vs SpeakMCP: Analysis & Improvement Opportunities

**Date:** 2025-12-26
**Purpose:** Analyze Continuous-Claude's MCP context management approach and identify improvements for SpeakMCP

---

## Executive Summary

Continuous-Claude and SpeakMCP solve different problems in the Claude agent ecosystem:

- **Continuous-Claude**: Command-line framework focused on *lossless state preservation* across context resets through ledgers and handoffs
- **SpeakMCP**: Desktop application focused on *concurrent session management* with profile-based isolation and multi-transport MCP support

While architecturally different, Continuous-Claude offers **7 key innovations** we can adapt for SpeakMCP.

---

## 1. COMPARATIVE ARCHITECTURE

### Continuous-Claude's Approach

**Philosophy:** "Clear, don't compact"
- Context resets via `/clear` instead of lossy compaction
- State preserved through markdown ledgers (lossless)
- Handoff documents for agent transitions
- SQLite FTS5 indexing for artifact search
- Hook-based automation (10 event types)

**MCP Integration:**
- Per-project `.mcp.json` configuration
- Avoids global MCP server pollution
- Tool isolation through Python runtime harness
- Execution: `uv run python -m runtime.harness scripts/<script>.py`

**Context Preservation:**
```
Session 1 → Ledger Update → /clear → Session 2 loads ledger
No information loss, full context reconstruction
```

### SpeakMCP's Approach

**Philosophy:** Session isolation with profile snapshots
- Multiple concurrent agent sessions
- Profile-based MCP configuration
- Context reduction through LLM summarization
- JSON-based conversation persistence

**MCP Integration:**
- Three transport types: stdio, websocket, streamableHttp
- OAuth 2.1 support
- Tool approval system
- Session-aware tool filtering

**Context Management:**
```
Profile Snapshot → Session Creation → Messages → Context Reduction (when needed)
Session isolation, but context compaction is lossy
```

---

## 2. KEY DIFFERENCES

| Feature | Continuous-Claude | SpeakMCP |
|---------|-------------------|----------|
| **State Persistence** | Markdown ledgers (lossless) | JSON conversations + in-memory sessions |
| **Context Strategy** | Clear & reload from ledger | Summarize old messages (lossy) |
| **MCP Configuration** | Per-project `.mcp.json` | Global + profile-based |
| **Tool Isolation** | Separate Python processes | Same process, different sessions |
| **Automation** | 10 hook types | No hooks (manual workflow) |
| **Search/Indexing** | SQLite FTS5 for handoffs | None (linear conversation JSON) |
| **Agent Orchestration** | Handoff-based multi-agent | Single agent per session |
| **Reasoning History** | Stored in git commits | Not tracked |
| **RepoPrompt Integration** | Yes (token-efficient codemaps) | No |
| **OAuth Support** | No | Yes (RFC 7591 + PKCE) |

---

## 3. IMPROVEMENT OPPORTUNITIES FOR SPEAKMCP

### **Priority 1: High Impact, Medium Effort**

#### A. **Per-Conversation MCP Configuration**
**Problem:** Currently SpeakMCP uses global config + profile overrides. All conversations in a profile share MCP settings.

**Continuous-Claude's Solution:** Per-project `.mcp.json` prevents global pollution and allows project-specific tooling.

**Proposed Improvement:**
```typescript
interface Conversation {
  id: string
  title: string
  messages: ConversationMessage[]
  mcpConfig?: ConversationMcpConfig  // NEW: optional conversation-specific config
}

interface ConversationMcpConfig {
  inheritFromProfile: boolean  // Default: true
  disabledServers?: string[]
  disabledTools?: string[]
  customServers?: MCPServerConfig[]  // Conversation-specific servers
}
```

**Benefits:**
- Allow conversations to have project-specific MCP tools
- Example: Python project conversation enables `ruff`, `mypy` MCP servers
- Example: Web project conversation enables `eslint`, `prettier` MCP servers
- Reduces global tool clutter

**Implementation Path:**
1. Extend `Conversation` interface with `mcpConfig` field
2. Add UI for per-conversation MCP settings (in conversation settings panel)
3. Update `mcpService.getAvailableToolsForProfile()` to accept `conversationMcpConfig`
4. Layer resolution: Conversation → Profile → Global

**Files to Modify:**
- `apps/desktop/src/main/conversation-service.ts` (add mcpConfig field)
- `apps/desktop/src/main/mcp-service.ts` (add conversation-aware filtering)
- `apps/desktop/src/renderer/src/components/ConversationSettings.tsx` (new UI)

---

#### B. **Hook System for Automation**
**Problem:** SpeakMCP has no automation hooks. Users can't trigger actions on events like:
- Session start (e.g., load project context)
- Pre-tool-use (e.g., run linters before Edit/Write)
- Post-tool-use (e.g., index handoffs, track modified files)

**Continuous-Claude's Solution:** 10 hook types with shell/JS execution:
```typescript
enum HookType {
  SessionStart,         // Load ledger + handoff
  PreToolUse,          // Type-check before edits
  PostToolUse,         // Index artifacts
  UserPromptSubmit,    // Context % warnings
  PreCompact,          // Auto-generate handoff
  ...
}
```

**Proposed Improvement:**
```typescript
interface Hook {
  id: string
  name: string
  type: HookType
  enabled: boolean
  script: string  // Shell script or Node.js code
  filters?: {
    toolNames?: string[]  // Only trigger for specific tools
    filePatterns?: string[]  // Only trigger for specific file types
  }
}

interface HookExecutionContext {
  sessionId: string
  conversationId: string
  toolName?: string
  toolArgs?: any
  filePath?: string
  // Available to script via environment variables
}
```

**Use Cases for SpeakMCP:**
1. **Pre-Edit Hook:** Run TypeScript type-check before allowing file edits
2. **Post-Commit Hook:** Auto-generate commit summaries and store in conversation metadata
3. **Session-Start Hook:** Load project-specific context (README, docs) into first message
4. **Pre-Tool-Use Hook:** Warn if context usage > 80% before expensive operations
5. **Post-Tool-Use Hook:** Track modified files and update conversation "touched files" list

**Implementation Path:**
1. Create `hooks-service.ts` for hook registration and execution
2. Add hooks storage to profiles or global config
3. Integrate hook triggers at key points:
   - `conversation-service.ts`: SessionStart, SessionEnd
   - `mcp-service.ts`: PreToolUse, PostToolUse
   - `message-queue-service.ts`: UserPromptSubmit
4. Add hooks management UI (Settings → Hooks)
5. Provide hook template library (similar to Continuous-Claude)

**Files to Create:**
- `apps/desktop/src/main/hooks-service.ts`
- `apps/desktop/src/renderer/src/components/HooksManager.tsx`

**Files to Modify:**
- `apps/desktop/src/main/conversation-service.ts` (add hook triggers)
- `apps/desktop/src/main/mcp-service.ts` (add pre/post-tool hooks)
- `apps/desktop/src/main/message-queue-service.ts` (add prompt submit hook)

---

### **Priority 2: High Impact, High Effort**

#### C. **Ledger System for Lossless State Preservation**
**Problem:** SpeakMCP uses LLM summarization for context reduction (lossy). Critical details can be lost.

**Continuous-Claude's Solution:** Markdown ledgers that preserve:
- Goal and constraints
- Completed work vs pending tasks
- Architectural decisions
- Active file references with line numbers
- Current focus for StatusLine

**Proposed Improvement:**
```typescript
interface ConversationLedger {
  conversationId: string
  version: number
  updatedAt: number
  sections: {
    goal: string
    constraints: string[]
    completed: string[]
    pending: string[]
    decisions: Array<{
      timestamp: number
      decision: string
      rationale: string
      files: string[]
    }>
    activeFiles: Array<{
      path: string
      lineNumbers?: [number, number]
      purpose: string
    }>
    currentFocus: string
  }
}
```

**Workflow:**
1. User triggers "Save State" → AI generates ledger from conversation
2. On context limit → Show "Load from ledger?" option instead of auto-summarize
3. User clicks "Reset Context" → Conversation messages cleared, ledger loaded as first message
4. AI continues from ledger state (lossless)

**Benefits:**
- No information loss from summarization
- User controls what's preserved
- Explicit state snapshots for long-running projects
- Can be version-controlled (export to `.md` file)

**Implementation Path:**
1. Create `ledger-service.ts` for ledger generation and loading
2. Add "Generate Ledger" tool call for AI to invoke
3. Add UI buttons: "Save State", "Load Ledger", "Reset Context"
4. Store ledgers in conversation metadata or separate files
5. Use structured prompts to generate consistent ledger format

**Files to Create:**
- `apps/desktop/src/main/ledger-service.ts`
- `apps/desktop/src/renderer/src/components/LedgerManager.tsx`

---

#### D. **Artifact Indexing with Full-Text Search**
**Problem:** No way to search across conversation history or handoffs. Finding previous decisions requires manual scrolling.

**Continuous-Claude's Solution:** SQLite FTS5 database indexing:
- All handoffs automatically indexed
- Search by content: `artifact_query.py --search "term"`
- Retrieve unmarked outcomes
- Linked to trace IDs for debugging

**Proposed Improvement:**
```typescript
interface ArtifactIndex {
  id: string
  conversationId: string
  type: "handoff" | "decision" | "plan" | "outcome"
  timestamp: number
  title: string
  content: string
  metadata: {
    files?: string[]
    tools?: string[]
    outcome?: "success" | "partial" | "failed"
  }
}

// Using SQLite FTS5 or simple lunr.js for search
class ArtifactIndexService {
  async index(artifact: ArtifactIndex): Promise<void>
  async search(query: string, filters?: { conversationId?, type? }): Promise<ArtifactIndex[]>
  async getUnmarkedOutcomes(): Promise<ArtifactIndex[]>
}
```

**Use Cases:**
1. Search: "What did we decide about authentication?" → Finds decision artifacts
2. Search: "Failed database migrations" → Finds error outcomes
3. UI: Conversation sidebar shows "Key Decisions" extracted from index
4. Export: Generate markdown summary from indexed artifacts

**Implementation Path:**
1. Integrate better-sqlite3 (already in project?) or lunr.js for lightweight search
2. Create FTS5 table schema for artifacts
3. Auto-index on PostToolUse hook (when artifact-generating tools execute)
4. Add search UI in conversation sidebar
5. Add artifact marking UI (success/partial/failed)

**Files to Create:**
- `apps/desktop/src/main/artifact-index-service.ts`
- `apps/desktop/src/renderer/src/components/ArtifactSearch.tsx`

---

### **Priority 3: Medium Impact, Low Effort**

#### E. **Reasoning History in Git Commits**
**Problem:** When reviewing git history, context about *why* changes were made is lost.

**Continuous-Claude's Solution:** Store reasoning in `.git/claude/commits/<hash>/reasoning.md`

**Proposed Improvement:**
- When AI executes git commit, also write reasoning to `.git/claude/commits/<commit-hash>/reasoning.md`
- Reasoning includes: problem statement, approach, alternatives considered, decisions made
- Can be queried later: "Why did we choose approach X?"

**Implementation:**
```typescript
// In builtin-tools.ts or mcp-service.ts
async function executeGitCommit(message: string, sessionId: string) {
  const commitHash = await gitCommit(message)

  // Extract reasoning from session context
  const reasoning = await extractReasoningFromSession(sessionId)

  // Store in .git/claude/commits/<hash>/reasoning.md
  const reasoningPath = `.git/claude/commits/${commitHash}/reasoning.md`
  await fs.promises.mkdir(path.dirname(reasoningPath), { recursive: true })
  await fs.promises.writeFile(reasoningPath, reasoning)
}
```

**Benefits:**
- Git history becomes self-documenting
- Future sessions can query past reasoning
- Code review becomes easier (reviewers see AI's thought process)

---

#### F. **Per-Project MCP Server Recommendations**
**Problem:** Users don't know which MCP servers to enable for their project type.

**Continuous-Claude's Approach:** Documentation includes recommended MCP setups per project type.

**Proposed Improvement:**
```typescript
// Auto-detect project type and suggest MCP servers
async function detectProjectTypeAndSuggestMCPs(workingDir: string): Promise<MCPSuggestion[]> {
  const suggestions: MCPSuggestion[] = []

  // Python project: package.json, pyproject.toml, requirements.txt
  if (await exists('pyproject.toml')) {
    suggestions.push({
      serverName: 'ruff',
      reason: 'Python linting and formatting',
      config: { command: 'uvx', args: ['ruff-mcp'] }
    })
  }

  // TypeScript project: tsconfig.json
  if (await exists('tsconfig.json')) {
    suggestions.push({
      serverName: 'typescript-lsp',
      reason: 'TypeScript type checking',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-typescript'] }
    })
  }

  // etc...
  return suggestions
}
```

**UI Flow:**
1. User opens conversation in new working directory
2. SpeakMCP detects project files
3. Shows notification: "We recommend enabling: ruff, mypy, git for this Python project"
4. User clicks "Enable Recommended" → Servers added to conversation MCP config
5. Session starts with project-appropriate tools

---

#### G. **Clear vs Compact Strategy**
**Problem:** SpeakMCP auto-summarizes when context limit approached (lossy). Continuous-Claude philosophy: "Clear, don't compact."

**Proposed Improvement:**
Add explicit user choice:
```
Context Limit Reached (85%)

Options:
1. [Clear & Load Ledger] - Start fresh with state preserved (recommended)
2. [Summarize Messages] - Compress old messages (may lose details)
3. [Continue Anyway] - Risk hitting hard limit
```

**Benefits:**
- User controls lossiness vs context
- Encourages ledger adoption
- Explicit about trade-offs

**Implementation:**
- Detect context % in `context-budget.ts`
- Emit warning at 85%
- Show modal in renderer with 3 options
- Handle user choice in `message-queue-service.ts`

---

## 4. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2)
- [ ] Implement per-conversation MCP configuration
- [ ] Add basic hook system (SessionStart, PreToolUse, PostToolUse)
- [ ] Create hook management UI

### Phase 2: State Preservation (Week 3-4)
- [ ] Implement ledger service
- [ ] Add "Save State" / "Load Ledger" UI
- [ ] Update context management to offer Clear vs Summarize

### Phase 3: Indexing & Search (Week 5-6)
- [ ] Integrate SQLite FTS5 or lunr.js
- [ ] Create artifact indexing service
- [ ] Add search UI to conversation sidebar
- [ ] Auto-index on PostToolUse hook

### Phase 4: Polish & Extensions (Week 7-8)
- [ ] Add reasoning history to git commits
- [ ] Implement project type detection and MCP recommendations
- [ ] Create hook template library
- [ ] Write documentation and user guides

---

## 5. WHAT NOT TO ADOPT

### Things Continuous-Claude Does That SpeakMCP Shouldn't:

1. **Command-Line Only Workflow**
   - Continuous-Claude is CLI-first; SpeakMCP is GUI-first
   - Keep desktop UI as primary interface

2. **Python Runtime Harness for MCP**
   - SpeakMCP already has robust multi-transport MCP support
   - No need to wrap everything in Python subprocess

3. **Braintrust Integration**
   - Continuous-Claude uses Braintrust for session tracing
   - SpeakMCP could add tracing later, but not priority

4. **RepoPrompt Dependency**
   - Paid service ($14.99/mo) for token-efficient codemaps
   - SpeakMCP can use built-in AST parsing or LSP servers instead

5. **Single-Session Focus**
   - Continuous-Claude assumes one active session
   - SpeakMCP supports concurrent sessions (keep this advantage!)

---

## 6. UNIQUE SPEAKMCP ADVANTAGES TO PRESERVE

### What SpeakMCP Does Better:

1. **OAuth 2.1 Support for MCP Servers**
   - Full RFC 7591 dynamic registration + PKCE
   - Continuous-Claude doesn't have this

2. **Multi-Transport MCP**
   - stdio, websocket, streamableHttp
   - Continuous-Claude is stdio-only

3. **Concurrent Session Management**
   - Multiple agent sessions with profile snapshots
   - Better for multi-tasking workflows

4. **Desktop UI**
   - Rich GUI for conversation management
   - Better for non-technical users

5. **Tool Approval System**
   - Inline approval for dangerous operations
   - More control than Continuous-Claude's auto-execute

---

## 7. RECOMMENDED PRIORITIES

### Must-Have (High ROI):
1. **Per-conversation MCP configuration** (A)
2. **Basic hook system** (B) - at least SessionStart, PreToolUse, PostToolUse
3. **Clear vs Compact choice** (G)

### Should-Have (Medium ROI):
4. **Ledger system** (C) - enables lossless state preservation
5. **Project-type MCP recommendations** (F)

### Nice-to-Have (Lower ROI):
6. **Artifact indexing with FTS** (D) - high effort, but powerful for long projects
7. **Reasoning history in git** (E) - low effort, good for code review

---

## 8. TECHNICAL CONSIDERATIONS

### Compatibility:
- All proposed features are additive (no breaking changes)
- Per-conversation MCP config can be optional (inherit from profile by default)
- Hooks can be disabled by default (opt-in)
- Ledgers are optional (users can continue with summarization)

### Performance:
- SQLite FTS5 is efficient (even for 1000s of artifacts)
- Hooks should have timeout limits (30s max)
- Ledger generation is async (doesn't block UI)

### User Experience:
- Don't overwhelm users with all features at once
- Add features progressively with good defaults
- Provide templates and examples (especially for hooks)
- Consider "guided setup" for first-time users

---

## 9. CONCLUSION

Continuous-Claude demonstrates excellent patterns for:
- **Lossless state preservation** (ledgers)
- **Automation** (hooks)
- **Search/indexing** (FTS5)
- **Per-project configuration** (.mcp.json)

SpeakMCP can adopt these patterns while preserving its unique strengths:
- GUI-first design
- Concurrent sessions
- Multi-transport MCP
- OAuth support

**Recommended First Steps:**
1. Implement per-conversation MCP config (highest value, medium effort)
2. Add basic hook system (3-5 hook types to start)
3. Add "Clear vs Compact" choice for context management

These three changes would immediately improve SpeakMCP's workflow without major architectural changes.

---

## References
- Continuous-Claude: https://github.com/parcadei/Continuous-Claude
- SpeakMCP: /home/user/SpeakMCP
- Analysis Date: 2025-12-26
