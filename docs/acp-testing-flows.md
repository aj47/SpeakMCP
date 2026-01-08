# ACP Multi-Agent Router Testing Flows

This document describes manual testing flows to verify the ACP multi-agent router functionality works correctly after the A2A simplification.

## Prerequisites

1. **SpeakMCP running** - Start the desktop app
2. **At least one ACP agent configured** (optional but recommended for full testing)
   - Example: Auggie, Claude Code, or a custom stdio agent
   - Configure in Settings → Agents

---

## Test Flow 1: List Available Agents

**Purpose**: Verify agent discovery works correctly.

**Steps**:
1. Start a conversation with SpeakMCP
2. Ask: "What agents are available to help me?"
3. The agent should use `list_available_agents` tool

**Expected Result**:
- Returns list of configured ACP agents
- Shows "internal" agent (SpeakMCP sub-session)
- Each agent shows name, description, and capabilities

**Verify**:
- [ ] Internal agent is listed
- [ ] Configured ACP agents are listed
- [ ] Disabled agents are NOT listed

---

## Test Flow 2: Internal Agent Delegation (Synchronous)

**Purpose**: Verify internal sub-session delegation works.

**Steps**:
1. Ask: "Delegate this task to the internal agent: Summarize what you can do"
2. Or more naturally: "Have your internal agent analyze this text: [some text]"

**Expected Result**:
- Task is delegated to internal sub-session
- Sub-session runs within same process
- Results are returned inline

**Verify**:
- [ ] Delegation completes successfully
- [ ] Result is returned to main conversation
- [ ] UI shows delegation progress (if applicable)
- [ ] No errors in console

---

## Test Flow 3: Internal Agent Delegation (Asynchronous)

**Purpose**: Verify async delegation with status checking.

**Steps**:
1. Ask: "Start a background task with the internal agent to research a topic, don't wait for it"
2. The agent should use `delegate_to_agent` with `waitForResult: false`
3. Note the `runId` returned
4. Ask: "Check the status of that task"

**Expected Result**:
- Initial response returns immediately with runId
- Status check shows progress/completion

**Verify**:
- [ ] Async delegation returns runId immediately
- [ ] `check_agent_status` shows correct state
- [ ] Final result is accessible when complete

---

## Test Flow 4: ACP Stdio Agent Delegation (if configured)

**Purpose**: Verify external ACP agent delegation works.

**Prerequisites**: Configure an ACP agent like Auggie or Claude Code

**Steps**:
1. Ask: "Have [agent-name] help me with [task]"
2. Or: "Delegate to [agent-name]: [task description]"

**Expected Result**:
- Agent is spawned if not running
- Task is sent via ACP protocol
- Results are returned

**Verify**:
- [ ] Agent spawns successfully
- [ ] Task delegation works
- [ ] Results return correctly
- [ ] UI shows delegation progress

---

## Test Flow 5: Spawn and Stop Agent

**Purpose**: Verify agent lifecycle management.

**Steps**:
1. Ask: "Spawn the [agent-name] agent"
2. Verify it's running
3. Ask: "Stop the [agent-name] agent"

**Expected Result**:
- Agent spawns successfully
- Agent stops successfully

**Verify**:
- [ ] `spawn_agent` works for stdio agents
- [ ] `stop_agent` terminates the process
- [ ] Error message if trying to spawn non-stdio agent

---

## Test Flow 6: Cancel Running Task

**Purpose**: Verify task cancellation works.

**Steps**:
1. Start an async delegation: "Start a long task with internal agent, don't wait"
2. Note the runId
3. Ask: "Cancel that task" or "Cancel task [runId]"

**Expected Result**:
- Task is cancelled
- Status changes to cancelled

**Verify**:
- [ ] `cancel_agent_run` stops the task
- [ ] Status reflects cancellation
- [ ] No orphaned processes

---

## Test Flow 7: Smart Router Suggestions

**Purpose**: Verify smart router recommends appropriate agents.

**Steps**:
1. Configure multiple agents with different capabilities
2. Ask for help with a task matching specific capabilities
3. Observe which agent is recommended/used

**Expected Result**:
- Router suggests agents based on capability match
- Confidence scores are appropriate

**Verify**:
- [ ] Agents with matching capabilities are suggested
- [ ] Confidence reflects relevance

---

## Test Flow 8: Error Handling

**Purpose**: Verify graceful error handling.

**Test Cases**:

### 8a. Non-existent Agent
- Ask: "Delegate to fake-agent: do something"
- **Expected**: Error message "Agent not found"

### 8b. Disabled Agent
- Disable an agent in settings
- Try to delegate to it
- **Expected**: Error message "Agent is disabled"

### 8c. Invalid runId
- Ask: "Check status of run_invalid123"
- **Expected**: Error message "Run not found"

**Verify**:
- [ ] Clear error messages
- [ ] No crashes or hangs
- [ ] Graceful degradation

---

## Test Flow 9: UI Progress Display

**Purpose**: Verify delegation progress shows in UI.

**Steps**:
1. Start a delegation that takes some time
2. Observe the UI during execution

**Expected Result**:
- Progress indicator shows
- Messages from sub-agent appear
- Completion is reflected

**Verify**:
- [ ] Real-time progress updates
- [ ] Final result displayed
- [ ] No UI freezing

---

## Verification Checklist Summary

After running all flows:

- [ ] App starts without errors
- [ ] Internal agent delegation works (sync)
- [ ] Internal agent delegation works (async)
- [ ] ACP stdio agent delegation works (if configured)
- [ ] Agent spawning works
- [ ] Agent stopping works
- [ ] Task cancellation works
- [ ] Status checking works
- [ ] Smart router suggestions work
- [ ] Error handling is graceful
- [ ] UI progress display works
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] All tests pass (`pnpm test`)

