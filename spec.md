# Spec: `respond_to_user` Tool — Explicit User Response Control

## Problem

The agent has no way to intentionally control what response reaches the user. Today, the final output (TTS on voice, message on mobile/WhatsApp) uses whatever ends up in `finalContent` — typically the agent's last text response or a post-verification summary. This creates a mismatch between what the agent *intends* to communicate and what the user receives.

### Example (Langfuse session `conv_1771557506882_kmmko0naf`)

User says: **"read me it"** (wanting to hear the tweet thread read aloud)

1. The agent generates a full readback of all 7 tweets (good)
2. Verification marks the task complete
3. A **second iteration** fires, producing: *"Work was already marked complete. The Discord recap and 7-tweet thread are saved in agent-notes, ready to post whenever you want."*
4. That dismissive status update becomes `finalContent` and gets delivered

The user heard a status update instead of the content they asked for.

### Root cause

The agent doesn't know its text output *is* the user-facing output. It treats assistant messages as status updates, thinking, or coordination — not as deliberate communication to the user. The `finalContent → delivery` pipeline is invisible to the model.

---

## Proposed Solution

Add a new builtin tool **`speakmcp-settings:respond_to_user`** that gives the agent explicit, intentional control over what gets delivered to the user.

### Core Concept

- The agent calls `respond_to_user` with the text it wants the user to receive
- **Only** text passed through this tool is delivered to the user
- On voice interfaces: spoken aloud via TTS
- On messaging channels (mobile, WhatsApp, etc.): sent as a message
- The agent's regular assistant messages remain internal (status updates, thinking, coordination)
- This cleanly separates *agent internal communication* from *user-facing response*

---

## Tool Definition

```typescript
{
  name: `${BUILTIN_SERVER_NAME}:respond_to_user`,
  description:
    "Send a response directly to the user. On voice interfaces this will be spoken aloud via TTS; " +
    "on messaging channels (mobile, WhatsApp, etc.) it will be sent as a message. " +
    "Regular assistant text is internal and not guaranteed to reach the user; " +
    "use this tool to explicitly communicate with them.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The response text for the user. Write naturally and conversationally, " +
          "without markdown or code formatting.",
      },
    },
    required: ["text"],
  },
}
```

---

## Behavior

### Tool handler (`builtin-tools.ts`)

The handler stores the user response on a per-session store so the agent loop can retrieve it later:

```typescript
respond_to_user: async (args, context) => {
  // Validate
  if (typeof args.text !== "string" || args.text.trim() === "") {
    return { content: [{ type: "text", text: '{"success":false,"error":"text is required"}' }], isError: true }
  }

  // Store on per-session state for retrieval by the agent loop
  userResponseStore.set(context.sessionId, args.text.trim())

  return {
    content: [{ type: "text", text: '{"success":true,"message":"Response recorded for delivery to user."}' }],
    isError: false,
  }
}
```

### Agent loop changes (`llm.ts`)

When the session completes (reaches `isComplete: true`), check if `respond_to_user` was called:

1. **If `respond_to_user` was called**: Use the stored response as `userResponse` on the progress update (new field). The existing `finalContent` remains unchanged for display purposes.
2. **If `respond_to_user` was NOT called**: Fall back to existing behavior — `finalContent` is used for delivery (backward compat).

### Progress update changes (`shared/types.ts`)

Add a new optional field to `AgentProgressUpdate`:

```typescript
export interface AgentProgressUpdate {
  // ... existing fields ...
  finalContent?: string    // displayed in UI (unchanged)
  /**
   * User-facing response set via respond_to_user tool.
   * On voice interfaces: spoken aloud via TTS
   * On messaging channels (mobile, WhatsApp): sent as a message
   * Falls back to finalContent if not set.
   */
  userResponse?: string
}
```

### Desktop changes (`agent-progress.tsx`)

Update the TTS trigger to prefer `userResponse` over `finalContent`:

```typescript
// Use userResponse from respond_to_user tool if available
const ttsText = progress.userResponse || message.content
const result = await tipcClient.generateSpeech({ text: ttsText })
```

### Mobile changes (`ChatScreen.tsx`)

Update the TTS and message handling to prefer `userResponse`:

```typescript
// Track userResponse from progress updates
let lastUserResponse: string | undefined;

const onProgress = (update: AgentProgressUpdate) => {
  if (update.userResponse) {
    lastUserResponse = update.userResponse;
  }
  // ... existing progress handling
};

// TTS: prefer userResponse over finalText
const ttsText = lastUserResponse || finalText;
if (ttsText && config.ttsEnabled !== false) {
  const processedText = preprocessTextForTTS(ttsText);
  Speech.speak(processedText, speechOptions);
}
```

### Langfuse tracing

The `respond_to_user` tool call will appear naturally in the trace as a tool span, making it easy to see exactly what the user received vs. what the agent wrote internally.

---

## Multi-Channel Support

The `userResponse` field is channel-agnostic:

| Channel | Delivery Method |
|---------|-----------------|
| Desktop (voice) | TTS via Groq/OpenAI |
| Mobile | TTS via expo-speech + display |
| WhatsApp (future) | Send as message via API |
| Telegram (future) | Send as message via API |
| Web (future) | Display as response |

Each channel implementation reads `userResponse` and delivers it appropriately.

---

## Interaction with Existing Systems

### `mark_work_complete`

These tools are **complementary**, not redundant:

- `mark_work_complete` — signals the agent loop that the task is done
- `respond_to_user` — controls what the user receives

Typical flow:
```
Agent does work → calls respond_to_user("Here's what I found...") → calls mark_work_complete({summary: "..."})
```

The completion nudge text (`INTERNAL_COMPLETION_NUDGE_TEXT`) should be updated to mention `respond_to_user`:

```typescript
export const INTERNAL_COMPLETION_NUDGE_TEXT =
  `If all requested work is complete, use respond_to_user to tell the user the result, ` +
  `then call ${MARK_WORK_COMPLETE_TOOL} with a concise summary. Otherwise continue working.`
```

### `generatePostVerifySummary`

When `respond_to_user` was called, the post-verify summary should **not** override `userResponse`. The summary still populates `finalContent` for UI display, but `userResponse` takes delivery priority.

### Verification system

No changes needed. The verifier checks whether the user's request was fulfilled — `respond_to_user` is just another tool call in the conversation history. In fact, it gives the verifier a clearer signal: if the agent called `respond_to_user` with substantive content, that's strong evidence of delivery.

### TTS preprocessing

No changes needed. `userResponse` flows through the same `preprocessTextForTTS` / `preprocessTextForTTSWithLLM` pipeline. Since the agent is instructed to write naturally (no markdown), preprocessing will be lighter.

### Streaming display

The streaming LLM call continues to work as-is for real-time text display. `respond_to_user` content is separate — it doesn't affect what appears in the streaming UI panel.

---

## System Prompt Guidance

Add to the agent's system prompt (or profile guidelines) so the model knows to use this tool:

```
## Responding to the User

You have a `respond_to_user` tool. This is how you communicate with the user —
on voice interfaces it will be spoken aloud, on messaging channels it will be sent as a message.
Your regular text responses are internal and NOT delivered to the user.

ALWAYS use `respond_to_user` when:
- Answering a question
- Reading content back to the user
- Providing a summary or result
- Confirming an action
- Any time you want the user to receive something

Write the response text naturally and conversationally. Avoid markdown,
code blocks, bullet points, or formatting — just natural speech/text.
```

---

## Migration / Backward Compatibility

- **No breaking changes**: If `respond_to_user` is never called, behavior is identical to today (delivery falls back to `finalContent`)
- **Gradual adoption**: The tool is available immediately. Existing profiles don't need changes — the fallback ensures they keep working
- **Profile-level opt-in**: Profiles that want the new behavior can add the system prompt guidance above to their guidelines

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/builtin-tool-definitions.ts` | Tool definition (renamed from speak_to_user) |
| `src/main/builtin-tools.ts` | Handler + import update |
| `src/main/session-user-response-store.ts` | Per-session user response store (renamed) |
| `src/shared/types.ts` | `userResponse?: string` field (renamed from spokenContent) |
| `src/main/llm.ts` | Populate `userResponse` from store when emitting final progress |
| `src/main/system-prompts.ts` | Updated guidance |
| `src/renderer/src/components/agent-progress.tsx` | Prefer `userResponse` for TTS |
| `apps/mobile/src/lib/openaiClient.ts` | Type update |
| `apps/mobile/src/screens/ChatScreen.tsx` | Use `userResponse` for TTS |

---

## Open Questions

1. **Multiple calls**: If the agent calls `respond_to_user` multiple times in a session, should we concatenate, or use only the last call? **Recommendation**: Use the last call — the agent refines its response as it works, and the final call represents its best answer.

2. **Mid-task responses**: Should `respond_to_user` be able to deliver mid-session (before completion), e.g., for progress updates like "I'm downloading the database now, this might take a minute"? **Recommendation**: Future enhancement. For v1, only deliver at session completion.

3. **Tool visibility in UI**: Should we show a visual indicator that `respond_to_user` was called (e.g., a message icon next to the tool call in the progress steps)? **Recommendation**: Yes, simple icon on the step.
