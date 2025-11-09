# UI State Test Cases for SpeakMCP Panel

## Test Suite: Panel UI State Management

> **Note**: When running tests with `--debug-ui` flag, all console logs from renderer processes (main, panel, setup) are automatically captured and displayed in the main console with window identifiers. See `src/main/console-logger.ts` for details.

### Test Case 1: Idle State (Default)
**Objective:** Verify panel is hidden when no activity is occurring

**Preconditions:**
- No active agent sessions
- No recording in progress
- No text input active

**Steps:**
1. Launch application
2. Wait for initialization to complete
3. Check panel visibility

**Expected Results:**
- Panel window should be hidden (`win.isVisible() === false`)
- No waveform visualization displayed
- `agentProgressById.size === 0`
- `focusedSessionId === null`
- `showTextInput === false`
- `recording === false`

**UI Logs to Verify:**
```
[AgentSessionTracker] getActiveSessions called, returning 0 sessions: []
[ActiveAgentsSidebar] No active sessions, hiding sidebar
[Panel] agentProgress changed: { hasProgress: false, sessionId: undefined, focusedSessionId: null, totalSessions: 0 }
```

**Current Bug:** ❌ Panel shows waveform visualization instead of being hidden

---

### Test Case 2: Voice Recording - Dictation Mode
**Objective:** Verify waveform displays during dictation recording

**Preconditions:**
- Panel is hidden (idle state)
- MCP tools disabled or using regular dictation shortcut

**Steps:**
1. Press and hold Ctrl key for 800ms
2. Speak for 2-3 seconds
3. Release Ctrl key
4. Wait for transcription

**Expected Results:**
- Panel appears with waveform visualization (50px height)
- `recording === true` while holding
- Waveform bars animate with audio input
- Panel hides after transcription completes
- No agent session created

**UI Logs to Verify:**
```
[Panel] agentProgress changed: { hasProgress: false, ... }
[Panel] Overlay visibility check: { hasAgentProgress: false, mcpTranscribePending: false }
```

**State Transitions:**
```
HIDDEN → RECORDING_DICTATION → HIDDEN
```

---

### Test Case 3: Voice Recording - Agent Mode
**Objective:** Verify agent session starts after MCP voice input

**Preconditions:**
- Panel is hidden (idle state)
- MCP tools enabled

**Steps:**
1. Press and hold Ctrl+Alt for 800ms
2. Speak: "List files in the current directory"
3. Release Ctrl+Alt
4. Wait for agent session to start

**Expected Results:**
- Panel shows waveform during recording (50px height)
- Panel resizes to agent mode (400px height) when session starts
- Agent progress panel displays immediately (no "Processing..." state)
- Session appears in active sessions list
- `agentProgressById.size === 1`
- `focusedSessionId === <new-session-id>`

**UI Logs to Verify:**
```
[AgentSessionTracker] Started session: session_XXXXX, total sessions: 1
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', iteration: '1/10', isComplete: false, isSnoozed: false }
[ConversationContext] Auto-focusing session: session_XXXXX
[Panel] agentProgress changed: { hasProgress: true, sessionId: 'session_XXXXX', focusedSessionId: 'session_XXXXX', totalSessions: 1 }
[Panel] Overlay visibility check: { hasAgentProgress: true, agentProgressSessionId: 'session_XXXXX', agentProgressComplete: false, agentProgressSnoozed: false }
[window.ts] resizePanelForAgentMode - starting...
[window.ts] resizePanelForAgentMode - setting size to: { width: 600, height: 401 }
[AgentSessionTracker] getActiveSessions called, returning 1 sessions: [{ id: 'session_XXXXX', title: '...', snoozed: undefined }]
```

**State Transitions:**
```
HIDDEN → RECORDING_AGENT → AGENT_ACTIVE
```

---

### Test Case 4: Text Input Mode
**Objective:** Verify text input panel displays correctly

**Preconditions:**
- Panel is hidden (idle state)

**Steps:**
1. Press Meta+T (or configured text input shortcut)
2. Type: "Write a haiku about coding"
3. Press Enter to submit
4. Wait for agent session to start

**Expected Results:**
- Panel appears with text input (180px height)
- Textarea is auto-focused
- After submit, panel resizes to agent mode (400px height)
- Agent progress displays immediately
- `showTextInput === true` initially
- `showTextInput === false` after agent progress arrives

**UI Logs to Verify:**
```
[Panel] Hiding text input because agent progress is available { sessionId: 'session_XXXXX' }
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', ... }
[Panel] agentProgress changed: { hasProgress: true, sessionId: 'session_XXXXX', ... }
[window.ts] resizePanelForTextInput - starting...
[window.ts] resizePanelForAgentMode - starting...
```

**State Transitions:**
```
HIDDEN → TEXT_INPUT → AGENT_ACTIVE
```

---

### Test Case 5: Agent Session - Minimize/Snooze
**Objective:** Verify session can be minimized and runs in background

**Preconditions:**
- One active agent session displayed in panel

**Steps:**
1. Start an agent session (via voice or text)
2. Click the minimize button in agent progress header
3. Verify panel hides
4. Wait 5 seconds
5. Check active sessions sidebar in main window

**Expected Results:**
- Panel hides immediately after minimize
- Session continues running in background
- `agentProgress.isSnoozed === true`
- `focusedSessionId === null`
- Session appears in sidebar with "snoozed" indicator
- Progress updates continue in background

**UI Logs to Verify:**
```
[AgentProgress OVERLAY] Minimize button clicked in OVERLAY: { sessionId: 'session_XXXXX', currentlySnoozed: false }
[AgentSessionTracker] Snoozing session: session_XXXXX, was snoozed: false
[AgentSessionTracker] Session session_XXXXX is now snoozed: true
[AgentProgress OVERLAY] Session snoozed, unfocused, and panel hidden
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', isSnoozed: true, ... }
[Panel] agentProgress changed: { hasProgress: false, focusedSessionId: null, totalSessions: 1 }
[window.ts] resizePanelToNormal - starting...
[ActiveAgentsSidebar] Sessions updated: { count: 1, sessions: [{ id: 'session_XXXXX', snoozed: true }] }
```

**State Transitions:**
```
AGENT_ACTIVE → HIDDEN (session continues in background)
```

---

### Test Case 6: Agent Session - Restore from Snooze
**Objective:** Verify snoozed session can be restored to foreground

**Preconditions:**
- One snoozed agent session running in background

**Steps:**
1. Open main window
2. Click on snoozed session in Active Agents Sidebar
3. Click the restore/maximize button

**Expected Results:**
- Panel appears and resizes to agent mode
- Session progress displays
- `agentProgress.isSnoozed === false`
- `focusedSessionId === <session-id>`
- Panel shows current progress state

**UI Logs to Verify:**
```
[ActiveAgentsSidebar SIDEBAR] Minimize button clicked in SIDEBAR: { sessionId: 'session_XXXXX', sidebarSaysIsSnoozed: true, action: 'unsnooze' }
[ActiveAgentsSidebar] Unsnoozing session
[AgentSessionTracker] Unsnoozing session: session_XXXXX, was snoozed: true
[AgentSessionTracker] Session session_XXXXX is now snoozed: false
[ConversationContext] External focusAgentSession received: session_XXXXX
[ConversationContext] agentProgress changed: { hasProgress: true, sessionId: 'session_XXXXX', focusedSessionId: 'session_XXXXX' }
[window.ts] resizePanelForAgentMode - starting...
[ActiveAgentsSidebar] Session unsnoozed, focused, panel shown and resized
```

**State Transitions:**
```
HIDDEN (snoozed) → AGENT_ACTIVE
```

---

### Test Case 7: Multiple Agent Sessions - Sequential
**Objective:** Verify multiple sessions can run one after another

**Preconditions:**
- Panel is hidden (idle state)

**Steps:**
1. Start Session A: "Count to 5"
2. Wait for Session A to complete
3. Verify panel hides after 5s cleanup delay
4. Start Session B: "List environment variables"
5. Wait for Session B to complete

**Expected Results:**
- Session A runs and completes
- Panel hides after Session A cleanup
- Session B starts fresh
- Each session tracked independently
- `agentProgressById` contains only one session at a time

**UI Logs to Verify:**
```
[AgentSessionTracker] Started session: session_A, total sessions: 1
[AgentSessionTracker] Completing session: session_A, remaining sessions: 0
[AgentSessionTracker] getActiveSessions called, returning 0 sessions: []
[window.ts] resizePanelToNormal - starting...

[AgentSessionTracker] Started session: session_B, total sessions: 1
[AgentSessionTracker] Completing session: session_B, remaining sessions: 0
```

---

### Test Case 8: Multiple Agent Sessions - Concurrent
**Objective:** Verify multiple sessions can run simultaneously with tabs

**Preconditions:**
- Panel is hidden (idle state)

**Steps:**
1. Start Session X: "Write a haiku about coding"
2. Immediately start Session Y: "Explain quantum computing"
3. Verify both sessions are tracked
4. Click between tabs to switch focus
5. Wait for both to complete

**Expected Results:**
- Both sessions start simultaneously
- Panel shows tabs for switching between sessions
- `agentProgressById.size === 2`
- `activeSessionCount === 2`
- `hasMultipleSessions === true`
- Clicking tabs changes `focusedSessionId`
- MultiAgentProgressView displays with tab bar

**UI Logs to Verify:**
```
[AgentSessionTracker] Started session: session_X, total sessions: 1
[AgentSessionTracker] Started session: session_Y, total sessions: 2
[Panel] agentProgress changed: { hasProgress: true, totalSessions: 2, activeSessionCount: 2, hasMultipleSessions: true }
[AgentSessionTracker] getActiveSessions called, returning 2 sessions: [{ id: 'session_X', ... }, { id: 'session_Y', ... }]
[ConversationContext] Received progress update: { sessionId: 'session_X', ... }
[ConversationContext] Received progress update: { sessionId: 'session_Y', ... }
```

---

### Test Case 9: Kill Switch - Emergency Stop Single Session
**Objective:** Verify emergency kill switch stops active session

**Preconditions:**
- One active agent session running

**Steps:**
1. Start an agent session
2. Press Ctrl+Shift+Escape (emergency kill switch)
3. Verify session stops immediately

**Expected Results:**
- Session stops immediately
- `agentProgress.isComplete === true`
- Final step shows "Agent stopped" or "emergency kill switch"
- Panel hides after cleanup
- `agentProgressById.size === 0`

**UI Logs to Verify:**
```
[AgentSessionTracker] Stopping session: session_XXXXX, remaining sessions: 0
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', isComplete: true, ... }
[ConversationContext] Progress changed for session: session_XXXXX
[AgentSessionTracker] getActiveSessions called, returning 0 sessions: []
[ActiveAgentsSidebar] No active sessions, hiding sidebar
[window.ts] resizePanelToNormal - starting...
```

**State Transitions:**
```
AGENT_ACTIVE → HIDDEN
```

---

### Test Case 10: Kill Switch - Stop Specific Session (Multiple Active)
**Objective:** Verify individual session can be stopped when multiple are running

**Preconditions:**
- Two active agent sessions running

**Steps:**
1. Start Session X and Session Y
2. Focus Session X (click its tab)
3. Click the X button in Session X's header
4. Verify only Session X stops

**Expected Results:**
- Session X stops and is removed
- Session Y continues running
- Panel stays open showing Session Y
- `agentProgressById.size === 1`
- `focusedSessionId === <session-y-id>`

**UI Logs to Verify:**
```
[AgentSessionTracker] Stopping session: session_X, remaining sessions: 1
[AgentSessionTracker] getActiveSessions called, returning 1 sessions: [{ id: 'session_Y', ... }]
[Panel] agentProgress changed: { hasProgress: true, sessionId: 'session_Y', totalSessions: 1, hasMultipleSessions: false }
[ConversationContext] Received progress update: { sessionId: 'session_X', isComplete: true, ... }
```

---

### Test Case 11: Session Completion - Auto Cleanup
**Objective:** Verify completed sessions clean up after 5 seconds

**Preconditions:**
- One active agent session running

**Steps:**
1. Start a quick agent session (e.g., "What is 2+2?")
2. Wait for session to complete naturally
3. Observe panel for 5 seconds
4. Verify panel hides after cleanup delay

**Expected Results:**
- Session completes with `isComplete === true`
- Panel shows completion state for ~5 seconds
- Panel hides automatically after cleanup
- Session removed from `agentProgressById`

**UI Logs to Verify:**
```
[AgentSessionTracker] Completing session: session_XXXXX, remaining sessions: 0
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', isComplete: true, ... }
[ConversationContext] Session completed, scheduling cleanup in 5000ms
[ConversationContext] Cleaning up completed session: session_XXXXX
[AgentSessionTracker] getActiveSessions called, returning 0 sessions: []
[window.ts] resizePanelToNormal - starting...
```

---

### Test Case 12: No "Processing..." State
**Objective:** Verify agent progress displays immediately, no generic spinner

**Preconditions:**
- Panel is hidden (idle state)

**Steps:**
1. Start an agent session via text input
2. Immediately observe panel after submission
3. Verify agent progress displays without intermediate spinner

**Expected Results:**
- NO "Processing..." spinner should appear
- Agent progress panel displays immediately
- First progress update shows "Initializing..." or first actual step
- `agentProgress !== null` from the start

**UI Logs to Verify:**
```
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', iteration: '1/10', stepsCount: 1 }
[Panel] agentProgress changed: { hasProgress: true, sessionId: 'session_XXXXX', ... }
```

**Current Bug:** ❌ Sometimes shows "Processing..." spinner before agent progress arrives

---

### Test Case 13: Panel Visibility - Recording States
**Objective:** Verify panel shows/hides correctly during recording

**Preconditions:**
- Panel is hidden

**Steps:**
1. Start dictation recording (hold Ctrl)
2. Verify panel appears with waveform
3. Release Ctrl
4. Verify panel hides after transcription
5. Start agent recording (hold Ctrl+Alt)
6. Verify panel appears with waveform
7. Release Ctrl+Alt
8. Verify panel transitions to agent mode (doesn't hide)

**Expected Results:**
- Panel visible only during recording for dictation
- Panel stays visible for agent mode (transitions to progress)
- Waveform animates during recording
- `recording === true` while holding keys

**UI Logs to Verify:**
```
[Panel] agentProgress changed: { hasProgress: false, ... }
[Panel] Overlay visibility check: { hasAgentProgress: false, mcpTranscribePending: true }
[Panel] Overlay visibility check: { hasAgentProgress: true, mcpTranscribePending: false }
```

---

### Test Case 14: State Persistence - Window Resize
**Objective:** Verify panel size persists across sessions

**Preconditions:**
- No active sessions

**Steps:**
1. Start an agent session
2. Resize panel to custom size (e.g., 800x500)
3. Complete or stop the session
4. Start a new agent session
5. Verify panel opens at saved size

**Expected Results:**
- Panel remembers last size for agent mode
- `getSavedSizeForMode('agent')` returns custom size
- Panel opens at saved dimensions

**UI Logs to Verify:**
```
[window.ts] getSavedSizeForMode(agent) - checking config...
[window.ts] Found saved agent mode size: { width: 800, height: 500 }
[window.ts] resizePanelForAgentMode - setting size to: { width: 800, height: 500 }
```

---

### Test Case 15: Concurrent Sessions - All Minimized
**Objective:** Verify panel hides when all sessions are snoozed

**Preconditions:**
- Two active agent sessions running

**Steps:**
1. Start Session A and Session B
2. Minimize Session A
3. Minimize Session B
4. Verify panel is hidden
5. Verify both sessions continue in background

**Expected Results:**
- Panel hides when last session is minimized
- Both sessions show in sidebar as snoozed
- `focusedSessionId === null`
- `activeSessionCount === 0` (all snoozed)
- Progress updates continue for both

**UI Logs to Verify:**
```
[AgentSessionTracker] Snoozing session: session_A
[AgentSessionTracker] Snoozing session: session_B
[Panel] agentProgress changed: { hasProgress: false, focusedSessionId: null, totalSessions: 2, activeSessionCount: 0 }
[ActiveAgentsSidebar] Sessions updated: { count: 2, sessions: [{ snoozed: true }, { snoozed: true }] }
[window.ts] resizePanelToNormal - starting...
```

**State Transitions:**
```
AGENT_ACTIVE (multiple) → HIDDEN (all snoozed)
```

---

## Summary of Expected UI Logs for Each State

### HIDDEN (Idle)
```
[AgentSessionTracker] getActiveSessions called, returning 0 sessions: []
[ActiveAgentsSidebar] No active sessions, hiding sidebar
[Panel] agentProgress changed: { hasProgress: false, focusedSessionId: null, totalSessions: 0 }
```

### RECORDING_DICTATION
```
[Panel] agentProgress changed: { hasProgress: false, ... }
[Panel] Overlay visibility check: { hasAgentProgress: false, mcpTranscribePending: false }
```

### RECORDING_AGENT
```
[Panel] Overlay visibility check: { hasAgentProgress: false, mcpTranscribePending: true }
```

### AGENT_ACTIVE (Single Session)
```
[AgentSessionTracker] Started session: session_XXXXX, total sessions: 1
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', iteration: 'X/10', isComplete: false, isSnoozed: false }
[Panel] agentProgress changed: { hasProgress: true, sessionId: 'session_XXXXX', totalSessions: 1, hasMultipleSessions: false }
[window.ts] resizePanelForAgentMode - setting size to: { width: 600, height: 401 }
[AgentSessionTracker] getActiveSessions called, returning 1 sessions: [...]
```

### AGENT_ACTIVE (Multiple Sessions)
```
[AgentSessionTracker] Started session: session_X, total sessions: 1
[AgentSessionTracker] Started session: session_Y, total sessions: 2
[Panel] agentProgress changed: { hasProgress: true, totalSessions: 2, hasMultipleSessions: true }
[AgentSessionTracker] getActiveSessions called, returning 2 sessions: [...]
```

### TEXT_INPUT
```
[window.ts] resizePanelForTextInput - starting...
[window.ts] resizePanelForTextInput - setting size to: { width: 380, height: 180 }
```

### Session Stopped (Kill Switch)
```
[AgentSessionTracker] Stopping session: session_XXXXX, remaining sessions: N
[ConversationContext] Received progress update: { sessionId: 'session_XXXXX', isComplete: true }
[AgentSessionTracker] getActiveSessions called, returning N sessions: [...]
```

### Session Snoozed
```
[AgentSessionTracker] Snoozing session: session_XXXXX
[Panel] agentProgress changed: { hasProgress: false, focusedSessionId: null }
[window.ts] resizePanelToNormal - starting...
```

### Session Unsnoozed
```
[AgentSessionTracker] Unsnoozing session: session_XXXXX
[ConversationContext] External focusAgentSession received: session_XXXXX
[window.ts] resizePanelForAgentMode - starting...
```

