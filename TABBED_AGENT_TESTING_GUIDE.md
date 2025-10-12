# Tabbed Agent Interface - Testing Guide

## 🚀 Quick Start

The tabbed agent interface is now running in dev mode! Follow this guide to test all the features.

---

## ✅ Pre-Testing Setup

### 1. Enable Tabbed Mode

1. Open the app (should be running now)
2. Click the settings icon (gear icon)
3. Navigate to **Settings → General**
4. Scroll down to **"Agent Interface"** section
5. Toggle **"Tabbed Mode"** to ON
6. The panel should now show tabs!

### 2. Verify Configuration

In the Agent Interface section, you should see:
- ✅ **Tabbed Mode** toggle (turn it ON)
- ✅ **Max Tabs** input (default: 10)
- ✅ **Auto-close Completed** toggle (optional)

---

## 🧪 Test Scenarios

### Test 1: Basic Tab Creation

**Steps:**
1. With tabbed mode enabled, open the panel (Ctrl+Alt or your shortcut)
2. You should see a tab bar at the top with one tab: "Agent 1"
3. Click the **+** button in the tab bar
4. A new tab "Agent 2" should appear
5. Try creating a few more tabs

**Expected Results:**
- ✅ New tabs appear with sequential names
- ✅ New tab becomes active automatically
- ✅ Tab bar shows all tabs
- ✅ Can create up to max tabs (default 10)

**Keyboard Shortcut:**
- Press **Cmd/Ctrl+T** to create new tab

---

### Test 2: Tab Switching

**Steps:**
1. Create 3-4 tabs
2. Click on different tabs to switch between them
3. Try keyboard shortcuts:
   - **Cmd/Ctrl+Tab** - Next tab
   - **Cmd/Ctrl+Shift+Tab** - Previous tab
   - **Cmd/Ctrl+1** - Jump to tab 1
   - **Cmd/Ctrl+2** - Jump to tab 2
   - etc.

**Expected Results:**
- ✅ Clicking tab switches to it
- ✅ Active tab is highlighted
- ✅ Keyboard shortcuts work
- ✅ Content area updates when switching

---

### Test 3: Tab Closing

**Steps:**
1. Create several tabs
2. Hover over a tab - close button (×) should appear
3. Click the × to close the tab
4. Try **Cmd/Ctrl+W** to close active tab
5. Close all tabs except one
6. Try to close the last tab

**Expected Results:**
- ✅ Close button appears on hover
- ✅ Tab closes when × clicked
- ✅ Cmd/Ctrl+W closes active tab
- ✅ When closing active tab, switches to adjacent tab
- ✅ Last tab can be closed (or stays open, depending on implementation)

---

### Test 4: Recording in Tabs

**Steps:**
1. Create a new tab (or use existing)
2. Press and hold **Ctrl+Alt** to start recording
3. Speak something (e.g., "What is the weather today?")
4. Release **Ctrl+Alt** to finish recording
5. Watch the tab status change

**Expected Results:**
- ✅ Tab shows **blue** indicator while recording
- ✅ Tab shows **"Recording..."** status
- ✅ After release, tab shows **yellow** indicator (processing)
- ✅ Agent progress appears in the tab content area

---

### Test 5: Multiple Simultaneous Agents

**This is the key test - the main advantage over multi-window!**

**Steps:**
1. Create Tab 1, start recording, ask a question
2. While Tab 1 is processing, press **Cmd/Ctrl+T** to create Tab 2
3. In Tab 2, start recording and ask another question
4. Create Tab 3 and start a third agent
5. Switch between tabs to see all agents processing

**Expected Results:**
- ✅ Can create new tabs while agents are processing
- ✅ Each tab shows its own agent progress
- ✅ All agents process simultaneously
- ✅ Switching tabs shows correct progress for each agent
- ✅ No interference between agents

---

### Test 6: Status Indicators

**Steps:**
1. Create multiple tabs with different states:
   - Tab 1: Idle (no activity)
   - Tab 2: Recording (hold Ctrl+Alt)
   - Tab 3: Processing (agent running)
   - Tab 4: Complete (agent finished)
   - Tab 5: Error (if possible to trigger)

**Expected Results:**
- ✅ **Idle**: No special indicator
- ✅ **Recording**: Blue border, mic icon
- ✅ **Processing**: Yellow border, spinner icon
- ✅ **Complete**: Green border, checkmark icon
- ✅ **Error**: Red border, alert icon

---

### Test 7: Badge Notifications

**Steps:**
1. Create 2 tabs
2. Start an agent in Tab 1
3. Switch to Tab 2 (make it active)
4. Wait for Tab 1 agent to make progress
5. Look at Tab 1 - should show a badge

**Expected Results:**
- ✅ Badge appears on inactive tabs with updates
- ✅ Badge shows number of updates (or "9+" if more than 9)
- ✅ Badge disappears when switching to that tab

---

### Test 8: Conversation History

**Steps:**
1. Start an agent and let it complete
2. Tab should show green checkmark
3. Click on the completed tab
4. Should show conversation history

**Expected Results:**
- ✅ Completed tab shows conversation
- ✅ Can see user message and agent response
- ✅ Can scroll through conversation
- ✅ Conversation persists when switching tabs

---

### Test 9: Max Tabs Limit

**Steps:**
1. Go to Settings → Agent Interface
2. Set **Max Tabs** to 3
3. Try to create more than 3 tabs

**Expected Results:**
- ✅ Can create up to max tabs
- ✅ Cannot create more than max
- ✅ Error message or disabled + button when at limit

---

### Test 10: Auto-Close Completed Tabs

**Steps:**
1. Go to Settings → Agent Interface
2. Enable **Auto-close Completed**
3. Start an agent and let it complete
4. Tab should automatically close

**Expected Results:**
- ✅ Completed tabs close automatically
- ✅ Switches to another tab after auto-close
- ✅ Only works when setting is enabled

---

### Test 11: Disable Tabbed Mode

**Steps:**
1. With tabbed mode enabled and tabs open
2. Go to Settings → Agent Interface
3. Disable **Tabbed Mode**
4. Panel should revert to traditional mode

**Expected Results:**
- ✅ Panel shows traditional single-agent interface
- ✅ No tabs visible
- ✅ Can still use agent mode normally
- ✅ Re-enabling tabbed mode works

---

## 🐛 Known Issues to Watch For

### Issue 1: Recording State Per Tab
- **Problem**: Recording might still be global, not per-tab
- **Test**: Try recording in Tab 1, switch to Tab 2, try recording again
- **Expected**: Should be able to record in any tab
- **Actual**: Might be blocked if recording is global

### Issue 2: Conversation ID Association
- **Problem**: Conversation ID might not associate correctly with tabs
- **Test**: Start multiple agents, check if progress goes to correct tabs
- **Expected**: Each agent's progress goes to its own tab
- **Actual**: Progress might go to wrong tab or active tab

### Issue 3: Tab Persistence
- **Problem**: Tabs are lost on app restart
- **Test**: Create tabs, close app, reopen
- **Expected**: Tabs might not persist (this is known)
- **Actual**: Tabs reset on restart

---

## 📊 Test Results Template

Use this template to record your test results:

```markdown
## Test Results - [Date]

### Test 1: Basic Tab Creation
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes: 

### Test 2: Tab Switching
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 3: Tab Closing
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 4: Recording in Tabs
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 5: Multiple Simultaneous Agents
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 6: Status Indicators
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 7: Badge Notifications
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 8: Conversation History
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 9: Max Tabs Limit
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 10: Auto-Close Completed Tabs
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

### Test 11: Disable Tabbed Mode
- Status: ✅ Pass / ❌ Fail / ⚠️ Partial
- Notes:

## Overall Assessment
- Critical Issues: 
- Medium Issues:
- Minor Issues:
- Recommendations:
```

---

## 🔧 Debugging Tips

### Check Console Logs
1. Open DevTools (Cmd/Ctrl+Shift+I)
2. Look for console logs:
   - "Created new tab: [id]"
   - "Closed tab: [id]"
   - "Switched to tab: [id]"
   - "Agent progress update received"

### Check Tab State
In DevTools console, you can inspect tab state:
```javascript
// This won't work directly, but you can add debug logging
// in use-agent-tabs.ts to see state changes
```

### Common Issues

**Tabs not appearing:**
- Check if tabbed mode is enabled in settings
- Check console for errors
- Try refreshing the panel

**Progress not routing correctly:**
- Check if conversation ID is being set
- Look for "Agent progress update received" logs
- Verify tab has correct conversation ID

**Keyboard shortcuts not working:**
- Check if focus is on the panel window
- Try clicking in the panel first
- Check for conflicting shortcuts

---

## 📝 Feedback

After testing, please provide feedback on:

1. **UX**: Is the tabbed interface intuitive?
2. **Performance**: Does it feel responsive?
3. **Bugs**: Any crashes or errors?
4. **Features**: What's missing?
5. **Improvements**: What could be better?

---

## 🎯 Success Criteria

The implementation is successful if:

- ✅ Can create multiple tabs
- ✅ Can switch between tabs easily
- ✅ Can run multiple agents simultaneously
- ✅ Progress routes to correct tabs
- ✅ Status indicators work correctly
- ✅ Keyboard shortcuts work
- ✅ No crashes or major bugs
- ✅ Better UX than single-panel mode

---

## 🚀 Next Steps After Testing

Based on test results:

1. **If all tests pass**: Move to Phase 3 (Visual Polish)
2. **If some tests fail**: Fix issues and retest
3. **If major issues**: Reassess approach

**Happy Testing!** 🎉

