## SpeakMCP GUI Unification Plan: Waveform, Progress, Text Input, and Results

### Summary
This document analyzes the current GUI flows for voice and text inputs, verifies behaviors with code references, identifies gaps, and proposes a phased plan to deliver a seamless, unified experience from input (voice/text) → progress → results.

---

### Verified Architecture (with evidence)

- Panel window is the progress UI with waveform and agent progress
  - Waveform rendering (panel):
    <augment_code_snippet path="src/renderer/src/pages/panel.tsx" mode="EXCERPT">
````tsx
{/* Waveform visualization */}
<div className={cn(
  "absolute right-0 flex h-6 items-center gap-0.5",
  (agentProgress && !mcpTranscribeMutation.isPending) || showContinueButton
    ? "opacity-30" : "opacity-100",
)}>
````
</augment_code_snippet>

  - Agent progress overlays the waveform:
    <augment_code_snippet path="src/renderer/src/pages/panel.tsx" mode="EXCERPT">
````tsx
{agentProgress && (
  <div className="absolute inset-0 z-20">
    <AgentProgress progress={agentProgress} variant="overlay" />
  </div>
)}
````
</augment_code_snippet>

- Agent progress events are emitted only to the panel window
  <augment_code_snippet path="src/main/llm.ts" mode="EXCERPT">
````ts
function emitAgentProgress(update: AgentProgressUpdate) {
  const panel = WINDOWS.get("panel")
  if (!panel) return
  if (!panel.isVisible()) { showPanelWindow() }
  const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
  setTimeout(() => handlers.agentProgressUpdate.send(update), 10)
}
````
</augment_code_snippet>

- Text input uses a dedicated panel size and then resizes for agent mode
  <augment_code_snippet path="src/main/window.ts" mode="EXCERPT">
````ts
state.isTextInputActive = true
resizePanelForTextInput()
showPanelWindow()
getWindowRendererHandlers("panel")?.showTextInput.send()
````
</augment_code_snippet>

- Router includes a standalone panel route
  <augment_code_snippet path="src/renderer/src/router.tsx" mode="EXCERPT">
````ts
{
  path: "/panel",
  lazy: () => import("./pages/panel"),
}
````
</augment_code_snippet>

- Final assistant response is currently added in TWO places (duplication risk)
  - In ConversationProvider (global):
    <augment_code_snippet path="src/renderer/src/contexts/conversation-context.tsx" mode="EXCERPT">
````tsx
if (update.isComplete && update.finalContent && currentConversationId) {
  addMessage(update.finalContent, "assistant").catch(() => {})
}
````
</augment_code_snippet>
  - In panel page (local):
    <augment_code_snippet path="src/renderer/src/pages/panel.tsx" mode="EXCERPT">
````tsx
if (update.isComplete) {
  if (update.finalContent) {
    addMessage(update.finalContent, "assistant").catch(() => {})
  }
}
````
</augment_code_snippet>

---

### Gaps Identified

1. Duplicate message insertion
   - Both ConversationProvider and panel.tsx add the final assistant message on completion, risking duplicates.

2. Main window doesn’t receive progress events
   - emitAgentProgress targets only panel, so Conversations UI in main cannot reflect live progress (even though components support it).

3. No deep-link to a specific conversation
   - The router exposes `/conversations` only; there is no `/conversations/:id` route, so we can’t navigate the main window directly to an active conversation.

4. Text input processing lacks waveform continuity
   - Voice path dims waveform under progress; text path swaps to an overlay without analogous visual continuity, leading to a jarring transition.

5. Duplicated processing overlay logic
   - AgentProcessingView exists but isn’t used consistently in panel and text input, causing duplicated UI patterns.

6. Mode indicators are asymmetric
   - MCP/agent mode has an indicator; text input mode lacks a clear, consistent indicator alongside voice.

7. Close/completion behaviors are not visually bridged to results
   - After completion, there’s no unified “View Full Results” CTA to transition users to the main conversations view.

---

### Final Detailed Plan (Phased, low-risk to higher-value)

#### Phase 0 — Correctness and Cleanup (low-risk)
- Remove duplicate final message addition from panel.tsx; rely on ConversationProvider to handle final assistant message insertion.
  - File: src/renderer/src/pages/panel.tsx
    - In the agentProgressUpdate listener, delete the block that calls `addMessage(update.finalContent, "assistant")` on completion.
  - Rationale: Single source of truth prevents duplicate messages.

Acceptance criteria:
- On agent completion, exactly one assistant message is added to the conversation.


#### Phase 1 — Consolidate Processing UI (use existing components)
- Adopt AgentProcessingView to standardize the processing overlay in both voice and text flows.
  - File: src/renderer/src/pages/panel.tsx
    - Replace custom overlay blocks (Processing… and AgentProgress overlay) with AgentProcessingView where appropriate.
  - File: src/renderer/src/components/text-input-panel.tsx
    - Use AgentProcessingView for the processing state instead of ad hoc overlay (or at minimum, align visuals: same padding, sizing, and progress variant).

- Maintain waveform continuity for voice (already dims underneath progress) and introduce a gentle typing/idle indicator background for text while processing (subtle, consistent with AgentProcessingView’s `showBackgroundSpinner`).

Acceptance criteria:
- Voice and text input show the same progress UI container and behavior.
- Waveform remains subtly visible behind progress for voice; text shows a subtle background indicator for equivalent continuity.


#### Phase 2 — Results Transition CTA
- Add a “View Full Results” CTA to the AgentProgress component when `isComplete` and `finalContent` are present.
  - File: src/renderer/src/components/agent-progress.tsx
    - In the header/footer area, render a small button: “View Full Results →”.
    - On click, request opening the main window to the Conversations page.

- Expose a router procedure to show the main window with an optional URL.
  - File: src/main/tipc.ts
    - Add `showMainWindow: t.procedure.input<{ url?: string }>().action(async ({ input }) => showMainWindow(input?.url))`.
  - File: src/renderer/src/lib/tipc-client.ts
    - Regenerate typings automatically (no manual edits needed) and call `tipcClient.showMainWindow({ url: "/conversations" })` from the CTA.

Acceptance criteria:
- After completion, clicking the CTA brings the user to main → Conversations.
- Panel remains open until ESC (existing behavior), no regressions.


#### Phase 3 — Optional Deep-Linking to Conversations
- Add `/conversations/:id` route and auto-select the conversation in detail view.
  - File: src/renderer/src/router.tsx
    - Add route for `path: "conversations/:id"`.
  - File: src/renderer/src/pages/conversations.tsx
    - Read route param; when present, set viewMode to detail and load that conversation.

- Modify CTA to pass the conversation id when available (requires ensuring the active conversation id is known in panel at completion time).

Acceptance criteria:
- CTA opens main window directly to the selected conversation detail.


#### Phase 4 — Unified Mode Indicators
- Add a small, consistent mode indicator for text input (📝) alongside existing MCP/agent indicator.
  - File: src/renderer/src/pages/panel.tsx
    - When `showTextInput` is true, render a subtle indicator in the left strip similar to MCP indicator.

Acceptance criteria:
- Users can visually distinguish Voice (🎤 waveform), Text (📝), and MCP/Agent states at a glance.


#### Phase 5 — Optional Live Progress in Main Window (advanced)
- Broadcast progress updates to main window to allow live progress visualization in Conversations.
  - File: src/main/llm.ts
    - In `emitAgentProgress`, also send updates to `WINDOWS.get("main")` if present.
  - File: src/renderer/src/contexts/conversation-context.tsx
    - Guard against duplicate final-message insertion by scoping message insertion to panel window only, e.g., only call `addMessage` if `window.location.pathname === "/panel"`.

- Conversations UI can then show a live, read-only progress card at the bottom of the messages list using existing `ConversationDisplay` logic.

Acceptance criteria:
- When the main window is open on a conversation, it shows live progress without duplicating messages.

---

### File-by-File Change Outline

- src/renderer/src/pages/panel.tsx
  - Remove duplicate final message insertion in agentProgressUpdate effect.
  - Replace custom overlays with AgentProcessingView where possible.
  - Add a text-input mode indicator in the left strip when `showTextInput`.

- src/renderer/src/components/text-input-panel.tsx
  - Swap to AgentProcessingView for processing state (or mirror its visuals and props).

- src/renderer/src/components/agent-progress.tsx
  - Add “View Full Results →” CTA when `isComplete && finalContent`.
  - Hook CTA to `tipcClient.showMainWindow({ url: "/conversations" })`.

- src/main/tipc.ts
  - Add `showMainWindow` procedure to call `showMainWindow(url)` from `src/main/window.ts`.

- src/renderer/src/router.tsx (Phase 3)
  - Add `/conversations/:id` route and adjust conversations page to read param.

- src/renderer/src/contexts/conversation-context.tsx (Phase 5)
  - Add guard: only insert final assistant message automatically in the panel window.

- src/main/llm.ts (Phase 5)
  - Broadcast progress to main window in addition to panel.

---

### Risks and Mitigations
- Duplicate messages: fixed in Phase 0; additional safeguard in Phase 5 if broadcasting to main.
- Navigation inconsistency: start with generic `/conversations` (Phase 2) before deep-linking (Phase 3).
- UI regressions: leverage existing AgentProcessingView; keep changes incremental and behind existing conditions.

---

### Testing Plan
- Unit: Conversation service message insertion (no duplicates on completion).
- Integration:
  - Voice flow: waveform → processing → CTA → conversations window.
  - Text flow: text input → processing → CTA → conversations window.
  - MCP/agent: ensure size transitions (normal → agent) remain correct.
- Manual UX checks:
  - ESC behavior still closes/resets panel.
  - Indicators show correctly for voice/text/MCP.
  - No flashing/flicker in overlays.

---

### Acceptance Criteria (Overall)
- Single source of truth for final message insertion (no duplicates).
- Consistent progress UI for voice and text inputs using a shared component.
- Clear CTA to view full results; navigates to main Conversations.
- Optional: deep-link to specific conversation and live progress in main without duplication.

