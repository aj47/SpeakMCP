# Long Variable Names Report

## Summary
Found **88 unique long variable names** (30+ characters) across the SpeakMCP repository with **144 total occurrences**.

## Top Long Variable Names by Category

### Transcript Post-Processing Configuration (Most Common)
These are configuration keys for transcript post-processing settings:

1. **`transcriptPostProcessingEnabled`** (31 chars) - 5 occurrences
2. **`transcriptPostProcessingProviderId`** (35 chars) - 8 occurrences
3. **`transcriptPostProcessingOpenaiModel`** (36 chars) - 7 occurrences
4. **`transcriptPostProcessingGroqModel`** (34 chars) - 7 occurrences
5. **`transcriptPostProcessingGeminiModel`** (36 chars) - 7 occurrences

### UI/Window Control Functions (Second Most Common)
These are function names for controlling the application window:

1. **`closeAgentModeAndHidePanelWindow`** (33 chars) - 6 occurrences
2. **`showPanelWindowAndStartRecording`** (33 chars) - 4 occurrences
3. **`showPanelWindowAndStartMcpRecording`** (36 chars) - 3 occurrences
4. **`showPanelWindowAndShowTextInput`** (32 chars) - 3 occurrences
5. **`stopRecordingAndHidePanelWindow`** (32 chars) - 3 occurrences
6. **`stopTextInputAndHidePanelWindow`** (32 chars) - 2 occurrences

### MCP Configuration Settings
1. **`mcpRequireApprovalBeforeToolCall`** (34 chars) - 6 occurrences
2. **`mcpContextSummarizeCharThreshold`** (33 chars) - 3 occurrences

### Other Long Names
1. **`customToggleVoiceDictationHotkey`** (33 chars) - 4 occurrences
2. **`registerExistingProcessesWithAgentManager`** (42 chars) - 3 occurrences
3. **`useAddMessageToConversationMutation`** (35 chars) - 2 occurrences
4. **`useDeleteAllConversationsMutation`** (34 chars) - 2 occurrences
5. **`handleOpenAITranscriptModelChange`** (34 chars) - 1 occurrence
6. **`handleGroqTranscriptModelChange`** (32 chars) - 1 occurrence
7. **`handleGeminiTranscriptModelChange`** (34 chars) - 1 occurrence
8. **`saveCompleteConversationHistory`** (32 chars) - 2 occurrences
9. **`isKnownIncompatibleWithStructuredOutput`** (40 chars) - 2 occurrences
10. **`makeStructuredContextExtraction`** (31 chars) - 2 occurrences

## Files with Most Long Variable Names
1. `src/renderer/src/pages/settings-general.tsx` - 12 occurrences
2. `src/renderer/src/lib/query-types.ts` - 8 occurrences
3. `src/main/config.ts` - 5 occurrences
4. `src/main/window.ts` - 8 occurrences
5. `src/main/keyboard.ts` - 6 occurrences

## Observations
- Most long names are **configuration keys** (transcript post-processing settings)
- Many are **function names** for UI control (window/panel management)
- These names are **descriptive and intentional** - they clearly communicate their purpose
- The length is justified by the complexity of what they represent
- No obvious candidates for shortening without losing clarity

