# PR #179 Review: Multi-Window Agent Mode

## 📋 Overview

**PR**: #179 - feat: implement multi-window agent mode  
**Branch**: `feature/174-multi-window-agents`  
**Status**: Open (Not Merged)  
**Created**: September 24, 2025  
**Last Updated**: October 1, 2025  
**Changes**: 14 files changed, 3,066 additions, 897 deletions  

## 🎯 Objective

Implements multi-window agent mode functionality allowing each agent session to run in its own separate window instead of using the floating panel. This enables users to manage multiple agents simultaneously and compare outputs side-by-side.

---

## 🔍 Detailed Analysis

### Architecture Changes

#### 1. **Window Management System** (`src/main/window.ts`)

**New Additions:**
- `AGENT_WINDOW_ID` type: Template literal type for agent windows (`agent-${string}`)
- `AGENT_WINDOWS` Map: Separate tracking for agent windows
- `createAgentWindow(conversationId)`: Creates dedicated agent windows
- `showAgentWindow(conversationId)`: Shows or creates agent window
- `closeAgentWindow(conversationId)`: Closes specific agent window
- `closeAllAgentWindows()`: Cleanup utility
- `getAgentWindow(conversationId)`: Retrieves agent window by conversation ID

**Implementation Details:**
- Agent windows positioned with 30px offset per window to avoid overlap
- Window size: 800x600 (vs panel 380x400)
- Proper cleanup on window close event
- Global agent state cleanup only when last agent window closes
- Routes to `/agent?conversationId={id}`

#### 2. **Agent Progress Routing** (`src/main/llm.ts`)

**Key Changes:**
- `emitAgentProgress()` now accepts optional `conversationId` parameter
- Routes progress updates to agent window when multi-window mode enabled
- Falls back to panel mode when multi-window disabled
- All 15+ progress emission points updated with conversationId

**Flow:**
```
Multi-window enabled + conversationId exists
  → Send to agent window
  → Return (don't send to panel)

Otherwise
  → Send to panel (traditional behavior)
```

#### 3. **TIPC Endpoints** (`src/main/tipc.ts`)

**New Endpoints:**
- `showAgentWindow({ conversationId })`: Create/show agent window
- `closeAgentWindow({ conversationId })`: Close specific agent window
- `closeAllAgentWindows()`: Close all agent windows
- `getAgentWindowExists({ conversationId })`: Check if window exists

**Integration:**
- `processWithAgentMode()` now creates agent window when multi-window enabled
- Passes `conversationId` through to `processTranscriptWithAgentMode()`

#### 4. **UI Components**

**New File: `src/renderer/src/pages/agent.tsx`** (162 lines)
- Dedicated agent window UI component
- Window controls (minimize, close)
- Conversation display with agent progress
- Real-time progress updates via IPC handlers
- Proper context providers (Theme, Conversation)
- Loading and error states

**Settings Integration: `src/renderer/src/pages/settings-general.tsx`**
- New "Agent Mode" section
- Toggle switch for multi-window mode
- Helpful tooltip explaining the feature

#### 5. **Configuration**

**Type Definition** (`src/shared/types.ts`):
```typescript
multiWindowAgentMode?: boolean
```

**Default Value** (`src/main/config.ts`):
```typescript
multiWindowAgentMode: false  // Disabled by default for backward compatibility
```

#### 6. **Preload API** (`src/preload/index.ts`)

**New API:**
- `minimizeWindow()`: IPC handler for window minimize

**Main Process Handler** (`src/main/index.ts`):
- `ipcMain.handle('minimizeWindow')`: Minimizes current window

#### 7. **Router** (`src/renderer/src/router.tsx`)

**New Route:**
```typescript
{
  path: "/agent",
  lazy: () => import("./pages/agent"),
}
```

---

## 🐛 Issues Identified

### 🔴 **Critical Issue: Progress Loss When Agent Window Missing**

**Location**: `src/main/llm.ts:269`  
**Severity**: P1 - Critical  
**Reported by**: chatgpt-codex-connector[bot]

**Problem:**
```typescript
function emitAgentProgress(update: AgentProgressUpdate, conversationId?: string) {
  const config = configStore.get()
  
  if (config.multiWindowAgentMode && conversationId) {
    const agentWindow = getAgentWindow(conversationId)
    if (agentWindow) {
      // ... send to agent window
    }
    return // ⚠️ ALWAYS returns here, even if agentWindow is undefined!
  }
  
  // Panel fallback code never reached when multi-window enabled
  const panel = WINDOWS.get("panel")
  // ...
}
```

**Impact:**
- If user closes agent window during processing, all progress updates are lost
- If agent window hasn't finished initializing, updates are dropped
- Final completion message never reaches any window
- Assistant reply is never persisted to conversation history
- User has no visibility into agent status

**Scenarios:**
1. User closes agent window mid-processing
2. Agent window creation delayed/fails
3. Window closed before final update sent

**Recommended Fix:**
```typescript
function emitAgentProgress(update: AgentProgressUpdate, conversationId?: string) {
  const config = configStore.get()
  
  if (config.multiWindowAgentMode && conversationId) {
    const agentWindow = getAgentWindow(conversationId)
    if (agentWindow) {
      try {
        const handlers = getRendererHandlers<RendererHandlers>(agentWindow.webContents)
        if (handlers.agentProgressUpdate) {
          setTimeout(() => {
            try {
              handlers.agentProgressUpdate.send(update)
            } catch (error) {
              console.warn("Failed to send progress update to agent window:", error)
            }
          }, 10)
        }
        return // Only return if successfully sent
      } catch (error) {
        console.warn("Failed to get agent window renderer handlers:", error)
        // Fall through to panel fallback
      }
    }
    // If no agent window, fall through to panel fallback
  }
  
  // Traditional panel mode (now acts as fallback)
  const panel = WINDOWS.get("panel")
  if (!panel) {
    console.warn("Panel window not available for progress update")
    return
  }
  // ... rest of panel logic
}
```

### 🟡 **Medium Issue: Window Reuse Behavior**

**Location**: User comment  
**Severity**: P2 - Medium  
**Reported by**: aj47

**Problem:**
User reports "seems to be re using same GUI window"

**Analysis:**
Looking at `showAgentWindow()`:
```typescript
export function showAgentWindow(conversationId: string) {
  const agentWindowId: AGENT_WINDOW_ID = `agent-${conversationId}`
  const existingWin = AGENT_WINDOWS.get(agentWindowId)

  if (existingWin) {
    existingWin.show()
    existingWin.focus()
    return existingWin  // Reuses existing window
  } else {
    return createAgentWindow(conversationId)
  }
}
```

**Expected Behavior**: Each agent session should get its own window  
**Actual Behavior**: Same conversation ID reuses the same window

**Questions:**
- Is this intentional (one window per conversation)?
- Or should each agent invocation create a new window?
- Should there be a "new window" vs "reuse window" option?

**Recommendation:**
- Clarify the intended behavior in documentation
- If reuse is intentional, this is correct
- If new windows are desired, generate unique window IDs per invocation

### 🟢 **Minor Issue: State Cleanup Logic**

**Location**: `src/main/window.ts:154-160`

**Observation:**
```typescript
win.on("close", () => {
  AGENT_WINDOWS.delete(agentWindowId)
  if (state.isAgentModeActive) {
    if (AGENT_WINDOWS.size === 0) {
      state.isAgentModeActive = false
      state.shouldStopAgent = false
      state.agentIterationCount = 0
    }
  }
})
```

**Potential Issue:**
- Global state cleanup only happens when ALL agent windows close
- If multiple agents running, closing one doesn't stop its processing
- Could lead to orphaned agent processes

**Recommendation:**
- Consider per-conversation agent state tracking
- Or document that agent processes continue even if window closes

---

## ✅ Strengths

1. **Clean Architecture**: Separate Map for agent windows, clear separation of concerns
2. **Backward Compatible**: Defaults to false, existing behavior preserved
3. **Comprehensive Integration**: All 15+ progress emission points updated
4. **Proper Cleanup**: Window close handlers and state management
5. **Good UX**: Window positioning offsets, proper controls, loading states
6. **Type Safety**: Strong typing with template literal types
7. **Error Handling**: Try-catch blocks around IPC communication
8. **Documentation**: Good tooltips and PR description

---

## 🧪 Testing Recommendations

### Manual Testing Checklist

- [ ] **Basic Functionality**
  - [ ] Enable multi-window mode in settings
  - [ ] Start agent with Ctrl+Alt
  - [ ] Verify new window opens
  - [ ] Verify progress updates appear in agent window
  - [ ] Verify completion message appears
  - [ ] Verify conversation saved correctly

- [ ] **Multiple Windows**
  - [ ] Start multiple agents simultaneously
  - [ ] Verify each gets its own window
  - [ ] Verify windows positioned with offsets
  - [ ] Verify progress updates go to correct windows

- [ ] **Window Management**
  - [ ] Test minimize button
  - [ ] Test close button
  - [ ] Test closing window mid-processing (⚠️ Critical test)
  - [ ] Test reopening same conversation

- [ ] **Fallback Behavior**
  - [ ] Disable multi-window mode
  - [ ] Verify panel mode still works
  - [ ] Toggle between modes

- [ ] **Edge Cases**
  - [ ] Close agent window immediately after creation
  - [ ] Close agent window during processing
  - [ ] Start agent without conversation ID
  - [ ] Network errors during agent processing

### Automated Testing Suggestions

```typescript
// Test: emitAgentProgress fallback
describe('emitAgentProgress', () => {
  it('should fall back to panel when agent window missing', () => {
    // Setup: multi-window enabled, no agent window exists
    // Action: emit progress
    // Assert: panel receives update
  })
  
  it('should fall back to panel when agent window closed', () => {
    // Setup: create agent window, then close it
    // Action: emit progress
    // Assert: panel receives update
  })
})

// Test: window lifecycle
describe('Agent Window Lifecycle', () => {
  it('should create unique windows for different conversations', () => {
    // Action: create windows for conv1, conv2
    // Assert: two separate windows exist
  })
  
  it('should reuse window for same conversation', () => {
    // Action: show window for conv1 twice
    // Assert: same window instance
  })
})
```

---

## 📊 Code Quality Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| Architecture | ⭐⭐⭐⭐ | Clean separation, good patterns |
| Type Safety | ⭐⭐⭐⭐⭐ | Excellent TypeScript usage |
| Error Handling | ⭐⭐⭐ | Good, but critical fallback missing |
| Testing | ⭐⭐ | No automated tests included |
| Documentation | ⭐⭐⭐⭐ | Good PR description, inline comments |
| Backward Compatibility | ⭐⭐⭐⭐⭐ | Perfect - defaults to off |
| UX | ⭐⭐⭐⭐ | Good window management, clear controls |

**Overall**: ⭐⭐⭐⭐ (4/5) - Solid implementation with one critical issue

---

## 🚀 Recommendations

### Must Fix Before Merge (P1)

1. **Fix progress loss when agent window missing**
   - Implement fallback to panel when agent window unavailable
   - Ensure final completion messages always reach somewhere
   - Test window close during processing

### Should Fix (P2)

2. **Clarify window reuse behavior**
   - Document whether reuse is intentional
   - Consider adding option for "always new window"

3. **Add automated tests**
   - Test progress routing logic
   - Test window lifecycle
   - Test fallback scenarios

### Nice to Have (P3)

4. **Enhanced state management**
   - Consider per-conversation agent state
   - Better handling of orphaned processes

5. **User feedback**
   - Toast notification when agent window closes during processing
   - Option to restore closed agent window

6. **Documentation**
   - Add user guide for multi-window mode
   - Document keyboard shortcuts for window management

---

## 📝 Summary

This PR implements a well-architected multi-window agent mode feature with clean separation of concerns and good backward compatibility. However, there is **one critical issue** that must be addressed before merging:

**Critical**: Progress updates are lost when the agent window is missing or closed, leaving users without feedback and potentially losing conversation data.

Once the critical issue is fixed and tested, this PR will be ready for merge. The feature adds significant value for power users who want to manage multiple agents simultaneously.

**Recommendation**: Request changes to fix the critical progress loss issue, then approve after verification.

