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

### Approach C: Growing Scrollable Tiling System ⭐ RECOMMENDED

**Concept**: A dynamic tiling layout where session cards automatically arrange themselves in a responsive grid. As new sessions are created, tiles grow to fill available space. The entire dashboard is scrollable, with each tile also independently scrollable for long conversations.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [⚙️]  SpeakMCP                                    [+ Text] [🎤 Voice]            │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐      │
│  │ 🟢 Session #1       │  │ ✅ Session #2       │  │ 🔴 Session #3       │      │
│  │ "Analyze codebase"  │  │ "Write unit tests"  │  │ "Deploy to prod"    │      │
│  ├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤      │
│  │                     │  │                     │  │                     │      │
│  │ User: Can you...    │  │ User: Generate...   │  │ User: Deploy the... │      │
│  │                     │  │                     │  │                     │      │
│  │ Agent: I'll start   │  │ Agent: Here are     │  │ ❌ Error: Failed    │      │
│  │ by examining the    │  │ the tests I wrote:  │  │ to connect to AWS   │      │
│  │ project structure.  │  │                     │  │                     │      │
│  │                     │  │ ```typescript       │  │ Stack trace:        │      │
│  │ 🔧 Running: grep    │  │ describe('User')    │  │ ConnectionError...  │      │
│  │ 🔧 Running: read    │  │ { ... }             │  │                     │      │
│  │ ⏳ Analyzing...     │  │ ```                 │  │ [Retry] [Dismiss]   │      │
│  │                     │  │                     │  │                     │      │
│  │ [Continue input...] │  │ ✅ Completed        │  │                     │      │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘      │
│                                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐                               │
│  │ 💤 Session #4       │  │ ✅ Session #5       │                               │
│  │ "Refactor auth"     │  │ "Fix CSS bug"       │                               │
│  ├─────────────────────┤  ├─────────────────────┤                               │
│  │                     │  │                     │                               │
│  │ User: Refactor...   │  │ Agent: The issue    │                               │
│  │                     │  │ was a missing flex  │                               │
│  │ Agent: I found 3    │  │ property. Fixed in  │                               │
│  │ authentication      │  │ styles.css:42       │                               │
│  │ patterns that...    │  │                     │                               │
│  │                     │  │ [🔊 Play Response]  │                               │
│  │ [Snoozed - Resume?] │  │                     │                               │
│  └─────────────────────┘  └─────────────────────┘                               │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Tiling Behavior:**
```
1 session:    ┌────────────────────────────────────┐
              │         Full width tile            │
              └────────────────────────────────────┘

2 sessions:   ┌─────────────────┐ ┌─────────────────┐
              │     50%         │ │      50%        │
              └─────────────────┘ └─────────────────┘

3 sessions:   ┌─────────────────┐ ┌─────────────────┐
              │     50%         │ │      50%        │
              ├─────────────────┴─┴─────────────────┤
              │           Full width                │
              └─────────────────────────────────────┘

4+ sessions:  ┌───────────┐ ┌───────────┐ ┌───────────┐
              │   33%     │ │    33%    │ │    33%    │
              ├───────────┤ ├───────────┤ ├───────────┤
              │  (scroll) │ │  (scroll) │ │  (scroll) │
              └───────────┘ └───────────┘ └───────────┘
              ┌───────────┐ ┌───────────┐
              │   33%     │ │    33%    │  ← grows as needed
              └───────────┘ └───────────┘
                    ↓ page scrolls vertically ↓
```

- Tiles automatically reflow based on session count and window size
- Each tile has internal scroll for long conversations
- Page scrolls vertically when tiles exceed viewport
- New sessions animate in, completed sessions can collapse/minimize

**Each Session Card Shows:**
- Status indicator (🟢 active, ✅ complete, 🔴 error, 💤 snoozed)
- Session title/first prompt
- **Full conversation history** (scrollable within tile)
- Current tool executions with live status
- Error details when applicable
- Action buttons (Continue, Retry, Dismiss, Play TTS)
- Input field for continuing conversation (active sessions)

**Tile Sizing Options:**
```
┌─────────────────────────────────────────────────────────────┐
│  View: [Compact ▾]  [Medium ▾]  [Expanded ▾]  [Auto-fit ▾]  │
└─────────────────────────────────────────────────────────────┘

Compact:   3-4 messages visible, more cards on screen
Medium:    6-8 messages visible, balanced density
Expanded:  Full conversation, fewer cards visible
Auto-fit:  Adjusts based on window size and session count
```

**Pros:**
- See substantial content from MULTIPLE sessions at once
- Live updates visible across all active sessions
- Quick context switching without losing sight of others
- Natural for monitoring parallel agent tasks
- Scales well: 1 session = full width, many = grid

**Cons:**
- Needs horizontal scrolling or wrapping for many sessions
- Complex layout logic
- May need responsive breakpoints

---

### Approach D: Stacked Feed (Single Column, Multiple Expanded)

**Concept**: Vertically stacked cards, each showing substantial content. Like a social feed but for agent sessions.

```
┌────────────────────────────────────────────────────────────┐
│ [⚙️]  SpeakMCP                    [+ Text] [🎤 Voice]      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🟢 Session #1 - "Analyze the authentication flow"    │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ User: Can you analyze how authentication works in    │  │
│  │ this codebase and identify any security issues?      │  │
│  │                                                      │  │
│  │ Agent: I'll examine the authentication flow. Let me  │  │
│  │ start by finding the relevant files...               │  │
│  │                                                      │  │
│  │ 🔧 grep "authenticate" → Found 12 matches            │  │
│  │ 🔧 read src/auth/login.ts → Examining...             │  │
│  │ ⏳ Analyzing token validation logic...               │  │
│  │                                                      │  │
│  │ ┌──────────────────────────────────────┐ [Stop]     │  │
│  │ │ Continue conversation...             │ [Send]     │  │
│  │ └──────────────────────────────────────┘            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ✅ Session #2 - "Write unit tests for UserService"   │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ User: Generate comprehensive unit tests for the      │  │
│  │ UserService class                                    │  │
│  │                                                      │  │
│  │ Agent: I've created 8 test cases covering:           │  │
│  │ • User creation (valid/invalid inputs)               │  │
│  │ • Password validation                                │  │
│  │ • Email verification flow                            │  │
│  │ • Edge cases for special characters                  │  │
│  │                                                      │  │
│  │ ```typescript                                        │  │
│  │ describe('UserService', () => {                      │  │
│  │   it('should create user with valid email', ...)     │  │
│  │ });                                                  │  │
│  │ ```                                                  │  │
│  │                                             [▼ More] │  │
│  │                                   [🔊 Play Response] │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🔴 Session #3 - "Deploy to production"         [✕]   │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ ❌ Error: AWS credentials not configured             │  │
│  │                                                      │  │
│  │ The deployment failed because AWS_ACCESS_KEY is      │  │
│  │ not set in your environment variables.               │  │
│  │                                                      │  │
│  │ [Retry with credentials]  [View full error]          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Maximum content visibility per session
- Simple vertical scrolling
- Works well on all screen sizes
- Easy to scan through all sessions

**Cons:**
- Can only see 2-3 sessions without scrolling
- Active sessions may scroll out of view
- Less efficient for monitoring many parallel tasks

---

### Approach E: Hybrid with Collapsible Sessions Panel

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

1. **`pages/sessions.tsx`** - New landing page (multi-column dashboard)
   - Responsive grid layout for session cards
   - View density controls (compact/medium/expanded)
   - Sorting/filtering options
   - Empty state for new users
   - Floating input bar at top

2. **`components/session-card.tsx`** - Rich session card with full content
   - **Header**: Status badge (🟢/✅/🔴/💤), title from first prompt, timestamp, close button
   - **Body** (scrollable):
     - Full conversation history (user messages + agent responses)
     - Tool execution steps with live status indicators
     - Code blocks with syntax highlighting
     - Error details with stack traces when applicable
   - **Footer**:
     - Continue input field (for active sessions)
     - Action buttons: Stop, Retry, Play TTS, Snooze, Dismiss
   - Auto-scroll to bottom on new messages
   - Configurable max-height with internal scroll

3. **`components/new-session-input.tsx`** - Unified input component
   - Text input field
   - Voice recording button with instructions
   - Submit/cancel affordances
   - Can target specific session or create new

4. **`components/session-grid.tsx`** - Grid layout manager
   - CSS Grid with responsive columns
   - Masonry-style or fixed-height options
   - Drag-to-reorder sessions
   - Pin important sessions to top

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

**Approach C (Growing Scrollable Tiling System)** with **Incremental Migration (Option 1)** is recommended because:

1. **Information density** - See multiple full conversations at once, not just previews
2. **Dynamic scaling** - Tiles grow/shrink automatically: 1 session = full width, many = responsive grid
3. **Parallel monitoring** - Watch several agents work simultaneously across all visible tiles
4. **Dual scroll** - Page scrolls vertically for many sessions; each tile scrolls internally for long conversations
5. **Familiar pattern** - Similar to dashboard/monitoring UIs (Grafana, TweetDeck)
6. **Leverages existing components** - `AgentProgress` and `ConversationDisplay` can be reused inside tiles

For the speech input UX, implement **Option 3 (Explicit Submit Button)** with keyboard shortcuts to address the cancel/submit clarity issue.

---

## Files to Modify (Estimated)

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/router.tsx` | Modify | Update routes structure |
| `src/renderer/src/pages/sessions.tsx` | New | Multi-column session dashboard |
| `src/renderer/src/components/session-card.tsx` | New | Rich session card with full conversation |
| `src/renderer/src/components/session-grid.tsx` | New | Responsive grid layout manager |
| `src/renderer/src/components/session-input.tsx` | New | Unified text/voice input component |
| `src/renderer/src/components/app-layout.tsx` | Modify | Restructure for sessions-first layout |
| `src/renderer/src/stores/agent-store.ts` | Modify | Add view settings, filtering, pinning |
| `src/renderer/src/pages/panel.tsx` | Modify | Update speech UI with explicit submit/cancel |
| `src/renderer/src/components/agent-progress.tsx` | Modify | Adapt for embedded card use |
| `src/renderer/src/components/conversation-display.tsx` | Modify | Compact mode for card embedding |
| `src/renderer/src/components/active-agents-sidebar.tsx` | Deprecate | Replaced by session dashboard |

---

## Summary

This redesign shifts SpeakMCP from a "settings app with voice features" to a **multi-session monitoring dashboard**. The key changes are:

1. **Growing scrollable tiling system** - Tiles automatically arrange and resize based on session count; page scrolls as sessions grow
2. **Rich session tiles** - Each tile shows complete conversation history, tool executions, code blocks, and errors with internal scrolling
3. **Live parallel monitoring** - Watch multiple agents work simultaneously with real-time updates across all visible tiles
4. **Dynamic layout** - 1 session = full width, 2 = 50/50, 3+ = responsive grid that grows vertically
5. **Integrated input** with text field + microphone button always visible at top
6. **Clear speech UX** with explicit submit/cancel affordances
7. **Settings demoted** to secondary navigation
8. **Incremental migration** to reduce risk and allow testing

**Key differentiator**: Information density + dynamic tiling. Users see 3-6 sessions with substantial content on screen. The tiling system grows organically as sessions are added, with each tile independently scrollable for long conversations.

Total estimated scope: Medium-Large (10-14 files, significant but not massive)
