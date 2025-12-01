# Brainstorm: Make Agent Session Management the Primary UI

**Issue:** [#355](https://github.com/aj47/SpeakMCP/issues/355)

## Current State

The current UI architecture:
- **Main Window**: Settings-focused with a left sidebar containing navigation links (General, History, Models, etc.) + an "Active Agents Sidebar" section at the bottom
- **Floating Panel**: Separate window for voice recording, text input, and agent progress display
- Agent sessions are treated as a secondary element tucked into the sidebar

## Proposed Changes

Transform the app so **agent sessions become the landing page** with voice/text input prominently featured, and settings/config moved to secondary locations.

---

## Design Approaches

### Approach A: Session Dashboard as Root Page

**Concept**: Replace the current settings-first layout with a session-centric dashboard.

```
┌────────────────────────────────────────────────────────────┐
│ [Settings ⚙️]                    SpeakMCP          [+ New] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│   │ Session │  │ Session │  │ Session │  │   +     │      │
│   │   #1    │  │   #2    │  │   #3    │  │  New    │      │
│   │ Active  │  │Complete │  │  Error  │  │         │      │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│                                                            │
│   ┌─────────┐  ┌─────────┐                                 │
│   │ Session │  │ Session │                                 │
│   │   #4    │  │   #5    │                                 │
│   │ Snoozed │  │Complete │                                 │
│   └─────────┘  └─────────┘                                 │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐  [🎤]   │
│  │ Type a message to start a new agent...       │  [Send] │
│  └──────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Clean, focused experience
- Immediate access to all sessions
- Input always visible at bottom

**Cons:**
- Significant restructuring of routing
- Need to rethink floating panel behavior

---

### Approach B: Split View with Session List + Active Session Detail

**Concept**: Left panel shows session list, right panel shows selected session detail.

```
┌────────────────────────────────────────────────────────────┐
│ [⚙️] SpeakMCP                                              │
├──────────────┬─────────────────────────────────────────────┤
│              │                                             │
│  Sessions    │   Session #1 - Active                       │
│  ──────────  │   ─────────────────────                     │
│  ● #1 Active │   [Conversation history...]                 │
│  ○ #2 Done   │                                             │
│  ○ #3 Error  │   Agent: "Here's what I found..."           │
│  ○ #4 Snoozed│                                             │
│              │   [Tool execution display]                  │
│  ──────────  │                                             │
│  [+ Text]    │                                             │
│  [🎤 Voice]  │   ┌─────────────────────────────┐           │
│              │   │ Continue conversation...   │ [Send]    │
│              │   └─────────────────────────────┘           │
├──────────────┴─────────────────────────────────────────────┤
│ [Settings] [History] [Models] [Tools]                      │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Familiar chat-app pattern (Slack, Discord)
- Session switching is intuitive
- Settings accessible but not dominant

**Cons:**
- May feel cramped on smaller screens
- More complex state management for selection

---

### Approach C: Hybrid with Collapsible Sessions Panel

**Concept**: Sessions as a collapsible overlay/drawer that can be dismissed.

```
Normal state (collapsed):
┌────────────────────────────────────────────────────────────┐
│ [☰ Sessions (3)]                    [⚙️ Settings]          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│          ┌─────────────────────────────────────┐           │
│          │                                     │           │
│          │      🎤  Start Speaking             │           │
│          │      or                             │           │
│          │  ┌──────────────────────────────┐   │           │
│          │  │ Type your request...         │   │           │
│          │  └──────────────────────────────┘   │           │
│          │                                     │           │
│          └─────────────────────────────────────┘           │
│                                                            │
└────────────────────────────────────────────────────────────┘

Expanded state (sessions panel open):
┌────────────────────────────────────────────────────────────┐
│ [☰ Sessions (3)] ✕                  [⚙️ Settings]          │
├──────────────────┬─────────────────────────────────────────┤
│  ● Session #1    │                                         │
│    Active        │     Current session or input...         │
│  ○ Session #2    │                                         │
│    Completed     │                                         │
│  ○ Session #3    │                                         │
│    Error         │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

**Pros:**
- Works well for single-window focus
- Progressive disclosure
- Clean starting point for new users

**Cons:**
- Extra click to see sessions
- May hide important active sessions

---

## Key Components to Create/Modify

### New Components

1. **`pages/sessions.tsx`** - New landing page
   - Grid/list view of sessions
   - Session cards with status indicators
   - Empty state for new users

2. **`components/session-card.tsx`** - Session preview card
   - Status badge (active, completed, error, snoozed)
   - Last message preview
   - Timestamp
   - Click to expand/focus

3. **`components/new-session-input.tsx`** - Unified input component
   - Text input field
   - Voice recording button with instructions
   - Submit/cancel affordances

4. **`components/session-detail.tsx`** - Full session view
   - Conversation history
   - Tool executions
   - Continue conversation input

### Modified Components

1. **`router.tsx`**
   - Change root `/` route to sessions page
   - Move settings to `/settings/*` routes
   - Add `/session/:id` route for detail view

2. **`components/app-layout.tsx`**
   - Restructure to prioritize sessions
   - Move settings to hamburger menu or bottom nav
   - Integrate input UI into main layout (not floating)

3. **`stores/agent-store.ts`**
   - Add session selection/focus state
   - Add session filtering/sorting
   - Add session grouping (active/completed/archived)

4. **`pages/panel.tsx`**
   - May be deprecated in favor of integrated input
   - Or converted to quick-access overlay

---

## Speech Mode UX Improvements

### Current Flow (unclear)
- User presses hotkey → Recording starts
- User releases/presses again → Recording ends → Transcribes → Submits

### Proposed Flow (explicit)

**Option 1: Toggle with Cancel**
```
┌─────────────────────────────────────────┐
│  🔴 Recording...                        │
│  [Waveform visualization]               │
│                                         │
│  [Cancel] ─── Release/press to submit   │
└─────────────────────────────────────────┘
```

**Option 2: Hold-to-Record**
```
┌─────────────────────────────────────────┐
│  🎤 Hold microphone button to record    │
│                                         │
│  (Releases automatically on release)    │
│  [Cancel if needed]                     │
└─────────────────────────────────────────┘
```

**Option 3: Explicit Submit Button**
```
┌─────────────────────────────────────────┐
│  🔴 Recording...                        │
│  [Waveform visualization]               │
│                                         │
│  [Cancel]                    [✓ Submit] │
└─────────────────────────────────────────┘
```

### Recommended: Option 3 with Keyboard Shortcuts
- Click microphone or press hotkey → Start recording
- Press hotkey again OR click Submit → Stop & submit
- Press Escape OR click Cancel → Cancel without submitting
- Visual instructions shown during recording

---

## Navigation & Information Architecture

### Current (Settings-First)
```
/                     → General Settings
/settings/history     → Conversation History
/settings/providers   → Provider Config
/settings/models      → Model Selection
/settings/tools       → Agent Tools
/settings/mcp-tools   → MCP Tools
/settings/remote      → Remote Server
/panel                → Floating Input (separate window)
```

### Proposed (Sessions-First)
```
/                     → Sessions Dashboard (NEW)
/session/:id          → Session Detail View (NEW)
/settings             → Settings Hub
/settings/general     → General Settings
/settings/providers   → Provider Config
/settings/models      → Model Selection
/settings/tools       → Agent Tools
/settings/mcp-tools   → MCP Tools
/settings/remote      → Remote Server
```

---

## Implementation Plan Options

### Option 1: Incremental Migration (Lower Risk)

1. **Phase 1**: Create new sessions page at `/sessions`
   - Keep existing `/` route as-is
   - Build session cards and grid view
   - Test with real session data

2. **Phase 2**: Integrate input into main window
   - Add persistent input area to sessions page
   - Connect to existing transcription/agent logic
   - Add clear submit/cancel for voice

3. **Phase 3**: Swap routes
   - Move settings to `/settings` prefix
   - Make sessions the new `/` route
   - Update navigation

4. **Phase 4**: Polish & deprecate
   - Remove/repurpose floating panel
   - Clean up dead code
   - Add animations/transitions

### Option 2: Full Redesign (Higher Risk, Cleaner Result)

1. Create complete new layout in parallel
2. Build all new components together
3. Swap in one go
4. Clean up old code

---

## Technical Considerations

### State Management
- Session list needs React Query for persistence + Zustand for local state
- Consider `useAgentStore` refactoring:
  ```typescript
  interface AgentState {
    sessions: Map<string, AgentSession>
    activeSessionId: string | null
    viewMode: 'grid' | 'list'
    sortBy: 'recent' | 'status' | 'name'
    filterStatus: 'all' | 'active' | 'completed' | 'error'
  }
  ```

### Persistence
- Session history should persist across app restarts
- Consider SQLite or localStorage for session metadata
- Current: sessions only exist while agent is running

### Floating Panel Fate
- **Option A**: Deprecate entirely, integrate into main window
- **Option B**: Keep as optional quick-access overlay (hotkey-activated)
- **Option C**: Convert to "mini mode" for background monitoring

### Responsive Design
- Current panel is resizable but main window isn't responsive
- Sessions grid should adapt: 4 cols → 2 cols → 1 col on smaller screens

---

## Open Questions

1. **Session Persistence**: Should sessions persist after app restart, or only show active/recent?

2. **Multi-Session Display**: When multiple agents are active, how to show them all? Tabs? Split view?

3. **Floating Panel**: Keep as optional overlay or fully integrate into main window?

4. **Empty State**: What does a new user see with no sessions?

5. **Session Archiving**: Can users archive/delete old sessions?

6. **Keyboard Navigation**: How should keyboard shortcuts work with new layout?

7. **Single vs Multi-Window**: Should this work in single-window mode only, or maintain multi-window support?

---

## Recommendation

**Approach B (Split View)** with **Incremental Migration (Option 1)** seems most practical because:

1. Leverages existing components (sidebar can become session list)
2. Familiar UX pattern users already know
3. Lower risk with incremental rollout
4. Maintains keyboard/hotkey ergonomics
5. Clear path to add features later

For the speech input UX, implement **Option 3 (Explicit Submit Button)** with keyboard shortcuts to address the cancel/submit clarity issue.

---

## Files to Modify (Estimated)

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/router.tsx` | Modify | Update routes structure |
| `src/renderer/src/pages/sessions.tsx` | New | Sessions dashboard page |
| `src/renderer/src/pages/session-detail.tsx` | New | Single session view |
| `src/renderer/src/components/session-card.tsx` | New | Session preview card |
| `src/renderer/src/components/session-input.tsx` | New | Unified input component |
| `src/renderer/src/components/app-layout.tsx` | Modify | Restructure layout |
| `src/renderer/src/stores/agent-store.ts` | Modify | Add selection/filtering |
| `src/renderer/src/pages/panel.tsx` | Modify | Update speech UI with clear submit/cancel |
| `src/renderer/src/components/active-agents-sidebar.tsx` | Modify/Deprecate | May merge into session list |

---

## Summary

This redesign shifts SpeakMCP from a "settings app with voice features" to a "session-centric AI assistant". The key changes are:

1. **Sessions as landing page** with grid/list of active and past sessions
2. **Integrated input** with text field + microphone button always visible
3. **Clear speech UX** with explicit submit/cancel affordances
4. **Settings demoted** to secondary navigation
5. **Incremental migration** to reduce risk and allow testing

Total estimated scope: Medium-Large (8-12 files, significant but not massive)
