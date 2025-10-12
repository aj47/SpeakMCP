# Tabbed Agent Interface - UI Mockup

## 🎨 Visual Design Concepts

### Concept 1: Browser-Style Tabs (Recommended)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SpeakMCP - Agent Manager                                    [_][□][×]   │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐┌──────────────┐┌──────────────┐┌────┐                │
│ │ 🎤 Email     ││ ⚙️ Code Rev  ││ 📝 Summary   ││ +  │                │
│ │ Processing.. ││ Complete ✓   ││ Error ⚠️     ││    │                │
│ └──────────────┘└──────────────┘└──────────────┘└────┘                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Active Tab: Email Agent                                                │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ 🎤 Recording... [████████░░] 80%                               │   │
│  │                                                                 │   │
│  │ Agent Progress:                                                │   │
│  │ ✓ Transcribed: "Check my email and summarize..."              │   │
│  │ ⚙️ Calling tool: gmail_list_messages                           │   │
│  │ ⏳ Processing results...                                       │   │
│  │                                                                 │   │
│  │ [Stop Agent] [View Full Conversation]                         │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Recent Activity:                                                       │
│  • 2:34 PM - Started email check                                       │
│  • 2:33 PM - Completed code review                                     │
│  • 2:30 PM - Generated summary                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Concept 2: Compact Tabs (Space-Efficient)

```
┌──────────────────────────────────────────────────────────────┐
│ [Email 🎤] [Code ✓] [Summary ⚠️] [+]              [_][□][×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  🎤 Recording Email Agent                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Transcript: "Check my email and summarize..."       │   │
│  │                                                      │   │
│  │ Progress:                                            │   │
│  │ ✓ Transcribed                                       │   │
│  │ ⚙️ Calling gmail_list_messages                      │   │
│  │ ⏳ Processing...                                     │   │
│  │                                                      │   │
│  │ [Stop] [View Conversation]                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Concept 3: Sidebar + Content (Alternative)

```
┌────────┬──────────────────────────────────────────────────┐
│ Agents │ Active: Email Agent                              │
├────────┼──────────────────────────────────────────────────┤
│        │                                                   │
│ 🎤 Email│ 🎤 Recording... [████████░░] 80%                │
│ ⚙️ Code │                                                   │
│ 📝 Summ │ Agent Progress:                                  │
│        │ ✓ Transcribed: "Check my email..."              │
│ [+]    │ ⚙️ Calling tool: gmail_list_messages            │
│        │ ⏳ Processing results...                         │
│        │                                                   │
│        │ Conversation History:                            │
│        │ ┌─────────────────────────────────────────┐     │
│        │ │ User: Check my email and summarize...   │     │
│        │ │ Agent: I'm checking your email now...   │     │
│        │ └─────────────────────────────────────────┘     │
│        │                                                   │
│        │ [Stop Agent] [Clear] [Export]                   │
│        │                                                   │
└────────┴──────────────────────────────────────────────────┘
```

---

## 🎯 Recommended: Concept 1 (Browser-Style)

### Why This Works Best

1. **Familiar**: Everyone knows how browser tabs work
2. **Visual Status**: Color-coded tabs show agent state
3. **Easy Navigation**: Click to switch, close button on each tab
4. **Scalable**: Can handle many tabs with scrolling
5. **Clean**: Maximizes content area

---

## 🎨 Tab States & Visual Indicators

### Tab State Colors

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 🎤 Recording │  │ ⚙️ Processing│  │ ✓ Complete   │  │ ⚠️ Error     │
│ [Blue]       │  │ [Yellow]     │  │ [Green]      │  │ [Red]        │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘

┌──────────────┐  ┌──────────────┐
│ ⏸️ Paused    │  │ 💬 Idle      │
│ [Gray]       │  │ [Default]    │
└──────────────┘  └──────────────┘
```

### Tab Icons

- 🎤 Recording
- ⚙️ Processing
- ✓ Complete
- ⚠️ Error
- 💬 Conversation
- 📝 Summary
- 🔍 Search
- 📧 Email
- 💻 Code

### Tab Badges

```
┌──────────────────┐
│ Email Agent   [3]│  ← Badge shows unread updates
└──────────────────┘

┌──────────────────┐
│ Code Review   ⚡ │  ← Lightning = high priority
└──────────────────┘
```

---

## 🖱️ Interaction Patterns

### Creating New Tab

**Option 1: Plus Button**
```
[Tab 1] [Tab 2] [+] ← Click to create new tab
```

**Option 2: Keyboard Shortcut**
```
Cmd/Ctrl + T → New tab
```

**Option 3: Voice Command**
```
User: "Start new agent"
System: Creates new tab and starts recording
```

### Closing Tabs

**Option 1: Close Button**
```
[Tab Name ×] ← Click × to close
```

**Option 2: Middle Click**
```
Middle-click on tab → Close tab
```

**Option 3: Keyboard Shortcut**
```
Cmd/Ctrl + W → Close active tab
```

**Option 4: Right-Click Menu**
```
Right-click → [Close]
              [Close Others]
              [Close to the Right]
              [Close All]
```

### Switching Tabs

**Option 1: Click**
```
Click on tab → Switch to that tab
```

**Option 2: Keyboard Shortcuts**
```
Cmd/Ctrl + Tab       → Next tab
Cmd/Ctrl + Shift+Tab → Previous tab
Cmd/Ctrl + 1-9       → Jump to tab 1-9
```

**Option 3: Drag to Reorder**
```
Drag tab left/right → Reorder tabs
```

---

## 📱 Responsive Design

### Desktop (Wide)
```
┌─────────────────────────────────────────────────────────────┐
│ [Tab 1] [Tab 2] [Tab 3] [Tab 4] [Tab 5] [+]                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Full content area                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Desktop (Narrow)
```
┌──────────────────────────────────────────┐
│ [Tab 1] [Tab 2] [▼] [+]                 │
├──────────────────────────────────────────┤
│                                           │
│  Content area                            │
│                                           │
└──────────────────────────────────────────┘
     ↑
     Dropdown for overflow tabs
```

### Compact Mode
```
┌────────────────────────┐
│ [1] [2] [3] [+]       │
├────────────────────────┤
│                        │
│  Content               │
│                        │
└────────────────────────┘
```

---

## 🎬 Animation & Transitions

### Tab Creation
```
1. User clicks [+]
2. New tab slides in from right
3. Tab becomes active with fade-in
4. Content area transitions smoothly
```

### Tab Switching
```
1. User clicks tab
2. Active tab indicator slides to new tab
3. Content fades out → fades in
4. Smooth 200ms transition
```

### Tab Closing
```
1. User clicks [×]
2. Tab shrinks and fades out
3. Adjacent tabs slide to fill space
4. If active tab closed, switch to nearest tab
```

---

## 🎨 Detailed Component Breakdown

### Tab Bar Component

```typescript
interface TabBarProps {
  tabs: AgentTab[]
  activeTabId: string
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onNewTab: () => void
  onTabReorder: (fromIndex: number, toIndex: number) => void
}

function TabBar({ tabs, activeTabId, ... }: TabBarProps) {
  return (
    <div className="tab-bar">
      <div className="tabs-container">
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClick={() => onTabClick(tab.id)}
            onClose={() => onTabClose(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
          />
        ))}
      </div>
      <button className="new-tab-button" onClick={onNewTab}>
        +
      </button>
    </div>
  )
}
```

### Individual Tab Component

```typescript
interface TabProps {
  tab: AgentTab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}

function Tab({ tab, isActive, onClick, onClose }: TabProps) {
  const statusIcon = getStatusIcon(tab.status)
  const statusColor = getStatusColor(tab.status)
  
  return (
    <div
      className={cn(
        "tab",
        isActive && "tab-active",
        `tab-${tab.status}`
      )}
      onClick={onClick}
      style={{ borderTopColor: statusColor }}
    >
      <span className="tab-icon">{statusIcon}</span>
      <span className="tab-title">{tab.title}</span>
      {tab.badge && <span className="tab-badge">{tab.badge}</span>}
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}
```

### Tab Content Component

```typescript
interface TabContentProps {
  tab: AgentTab
}

function TabContent({ tab }: TabContentProps) {
  return (
    <div className="tab-content">
      {tab.status === 'recording' && (
        <RecordingView tab={tab} />
      )}
      {tab.status === 'processing' && (
        <AgentProgressView progress={tab.progress} />
      )}
      {tab.status === 'complete' && (
        <ConversationView conversationId={tab.conversationId} />
      )}
      {tab.status === 'error' && (
        <ErrorView error={tab.error} />
      )}
    </div>
  )
}
```

---

## 🎨 CSS Styling (Tailwind)

```css
/* Tab Bar */
.tab-bar {
  @apply flex items-center gap-1 px-2 py-1 bg-muted/20 border-b;
}

.tabs-container {
  @apply flex gap-1 overflow-x-auto flex-1;
}

/* Individual Tab */
.tab {
  @apply flex items-center gap-2 px-3 py-2 rounded-t-lg;
  @apply bg-background/50 border-t-2 border-transparent;
  @apply hover:bg-background/80 cursor-pointer;
  @apply transition-all duration-200;
  @apply min-w-[120px] max-w-[200px];
}

.tab-active {
  @apply bg-background border-t-primary;
}

/* Tab States */
.tab-recording {
  @apply border-t-blue-500;
}

.tab-processing {
  @apply border-t-yellow-500;
}

.tab-complete {
  @apply border-t-green-500;
}

.tab-error {
  @apply border-t-red-500;
}

/* Tab Elements */
.tab-icon {
  @apply text-lg;
}

.tab-title {
  @apply flex-1 truncate text-sm font-medium;
}

.tab-badge {
  @apply px-1.5 py-0.5 text-xs rounded-full bg-primary text-primary-foreground;
}

.tab-close {
  @apply w-5 h-5 rounded hover:bg-muted/50;
  @apply flex items-center justify-center;
  @apply opacity-0 group-hover:opacity-100;
}

/* New Tab Button */
.new-tab-button {
  @apply w-8 h-8 rounded hover:bg-muted/50;
  @apply flex items-center justify-center;
  @apply text-lg font-light;
}
```

---

## 🚀 Implementation Phases

### Phase 1: Basic Tabs (MVP)
- ✅ Tab bar with static tabs
- ✅ Click to switch tabs
- ✅ Basic tab content rendering
- ✅ New tab button
- ✅ Close tab button

**Time**: 2-3 hours

### Phase 2: State Management
- ✅ Tab state persistence
- ✅ Route agent progress to correct tab
- ✅ Handle tab lifecycle
- ✅ Active tab tracking

**Time**: 2-3 hours

### Phase 3: Visual Polish
- ✅ Status colors and icons
- ✅ Smooth transitions
- ✅ Hover effects
- ✅ Loading states

**Time**: 2-3 hours

### Phase 4: Advanced Features
- ✅ Drag to reorder
- ✅ Keyboard shortcuts
- ✅ Right-click menu
- ✅ Tab badges
- ✅ Overflow handling

**Time**: 3-4 hours

### Phase 5: Integration
- ✅ Connect to agent system
- ✅ Handle multiple recordings
- ✅ Conversation management
- ✅ Error handling

**Time**: 3-4 hours

**Total**: 12-17 hours for full implementation

---

## 📊 User Testing Plan

### Test Scenarios

1. **Create Multiple Agents**
   - Start 3 agents in quick succession
   - Verify each gets its own tab
   - Verify all process simultaneously

2. **Switch Between Tabs**
   - Click between tabs
   - Use keyboard shortcuts
   - Verify content updates correctly

3. **Close Tabs**
   - Close individual tabs
   - Close all tabs
   - Verify cleanup happens

4. **Error Handling**
   - Agent fails in one tab
   - Verify other tabs unaffected
   - Verify error shown in correct tab

5. **Performance**
   - Create 10+ tabs
   - Verify UI remains responsive
   - Check memory usage

### Success Metrics

- ✅ Can run 3+ agents simultaneously
- ✅ Tab switching < 100ms
- ✅ No memory leaks
- ✅ Intuitive for new users
- ✅ Keyboard shortcuts work
- ✅ Visual feedback is clear

---

## 💡 Future Enhancements

1. **Tab Groups** - Group related agents
2. **Tab Search** - Search across all tabs
3. **Tab Templates** - Save common configurations
4. **Tab Sync** - Sync tabs across devices
5. **Tab History** - Reopen closed tabs
6. **Tab Pinning** - Pin important tabs
7. **Tab Notifications** - Alert when agent completes
8. **Tab Sharing** - Share agent results

---

## 🎯 Summary

The tabbed interface provides:
- ✅ True multi-agent capability
- ✅ Familiar, intuitive UX
- ✅ Clean, organized interface
- ✅ Efficient resource usage
- ✅ Easy to implement

**Recommendation**: Implement browser-style tabs (Concept 1) as the primary multi-agent interface.

