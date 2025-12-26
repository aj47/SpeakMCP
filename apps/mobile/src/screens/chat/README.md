# ChatScreen Refactoring

This directory contains the refactored ChatScreen components and hooks, extracted from the original 2,695-line `ChatScreen.tsx` mega-component.

## Structure

```
chat/
├── components/          # UI Components
│   ├── ConnectionBanner.tsx    # Connection status banners (reconnecting/failed)
│   ├── InputControls.tsx       # Text input, mic button, TTS toggle, send button
│   ├── MessageList.tsx         # Message rendering with tool execution display
│   └── index.ts                # Component exports
├── hooks/              # Custom Hooks
│   ├── useVoiceInputManager.ts       # Voice recording logic (startRecording, stopRecording, transcript state)
│   ├── useMessageProcessing.ts       # Message sending and queue processing
│   ├── useScrollAutomatic.ts         # Auto-scroll behavior with user interaction detection
│   ├── useConnectionManagement.ts    # Connection state management
│   └── index.ts                      # Hook exports
└── README.md           # This file
```

## Components

### ConnectionBanner
Displays connection status banners:
- Reconnecting status with retry count
- Failed message with retry button
- Auto-hides when not applicable

**Props:**
- `connectionState`: Current recovery state
- `lastFailedMessage`: Last message that failed to send
- `responding`: Whether agent is currently responding
- `onRetry`: Callback for retry button

### InputControls
Combined input controls for the chat interface:
- Multiline text input with keyboard shortcut support (Shift/Ctrl/Cmd+Enter to send)
- Microphone button with push-to-talk and hands-free modes
- TTS toggle button
- Send button

**Props:**
- `input`, `setInput`: Input text state
- `listening`, `liveTranscript`: Voice input state
- `handsFree`, `ttsEnabled`: Configuration flags
- `onSend`, `onToggleTts`: Action callbacks
- `startRecording`, `stopRecordingAndHandle`: Voice control functions

### MessageList
Renders the chat message list with:
- User and assistant message bubbles
- Tool execution display (collapsed/expanded states)
- Auto-scroll handling
- Message expansion/collapse for long messages

**Props:**
- `messages`: Array of chat messages
- `expandedMessages`: Record of expanded message indices
- `onToggleExpansion`: Toggle message expansion callback
- `isDark`: Dark mode flag
- `scrollViewRef`, `onScroll`, `onScrollBeginDrag`, `onScrollEndDrag`: Scroll control

## Hooks

### useVoiceInputManager
Manages voice input functionality for both web and native platforms.

**Features:**
- Cross-platform voice recognition (Web Speech API / expo-speech-recognition)
- Push-to-talk and hands-free modes
- Live transcript updates
- Voice gesture deduplication
- Auto-restart on voice breaks

**Returns:**
- `listening`: Whether voice input is active
- `liveTranscript`: Current live transcript
- `willCancel`: Whether gesture will cancel (edit mode)
- `startRecording()`: Start voice recording
- `stopRecordingAndHandle()`: Stop voice recording

### useMessageProcessing
Handles message sending and queue processing logic.

**Features:**
- Message sending with progress tracking
- Queue management for busy agent
- Session-aware request tracking
- Conversation history processing
- Error handling with retry support

**Returns:**
- `send(text)`: Send a message
- `processQueuedMessage(msg)`: Process a queued message
- `convertProgressToMessages(update)`: Convert progress updates to messages

### useScrollAutomatic
Manages automatic scrolling behavior with user interaction detection.

**Features:**
- Auto-scroll to bottom on new messages
- Pause auto-scroll when user scrolls up
- Resume auto-scroll when user scrolls back to bottom
- Debounced scrolling for rapid updates
- Session change handling

**Returns:**
- `scrollViewRef`: Ref for the ScrollView
- `shouldAutoScroll`: Whether auto-scroll is enabled
- `setShouldAutoScroll()`: Manually control auto-scroll
- `handleScroll()`: Scroll event handler
- `handleScrollBeginDrag()`: Drag start handler
- `handleScrollEndDrag()`: Drag end handler

### useConnectionManagement
Manages connection state and session tracking.

**Features:**
- Connection state subscription per session
- Active request tracking
- Session client management
- Auto-restore connection state on session switch

**Returns:**
- `responding`: Whether agent is currently responding
- `setResponding()`: Update responding state
- `connectionState`: Current recovery state
- `setConnectionState()`: Update connection state
- `activeRequestIdRef`: Ref for active request ID
- `currentSessionIdRef`: Ref for current session ID
- `getSessionClient()`: Get client for current session

## Usage Example

```typescript
import { useVoiceInputManager, useScrollAutomatic, useConnectionManagement } from './hooks';
import { ConnectionBanner, InputControls, MessageList } from './components';

function ChatScreen() {
  const { responding, connectionState, getSessionClient, ... } = useConnectionManagement();
  const { scrollViewRef, shouldAutoScroll, handleScroll, ... } = useScrollAutomatic({ messages, currentSessionId });
  const { listening, liveTranscript, startRecording, stopRecordingAndHandle } = useVoiceInputManager({
    handsFree,
    onSend: send,
    setInput,
  });

  return (
    <View>
      <MessageList
        messages={messages}
        expandedMessages={expandedMessages}
        onToggleExpansion={toggleMessageExpansion}
        scrollViewRef={scrollViewRef}
        onScroll={handleScroll}
        {...}
      />
      <ConnectionBanner
        connectionState={connectionState}
        lastFailedMessage={lastFailedMessage}
        responding={responding}
        onRetry={handleRetry}
      />
      <InputControls
        input={input}
        setInput={setInput}
        listening={listening}
        liveTranscript={liveTranscript}
        onSend={send}
        startRecording={startRecording}
        stopRecordingAndHandle={stopRecordingAndHandle}
        {...}
      />
    </View>
  );
}
```

## Benefits

1. **Separation of Concerns**: Each hook and component has a single, well-defined responsibility
2. **Reusability**: Components and hooks can be reused in other parts of the app
3. **Testability**: Smaller, focused units are easier to test in isolation
4. **Maintainability**: Easier to understand, modify, and debug individual pieces
5. **Type Safety**: Strong TypeScript typing throughout
6. **Performance**: Isolated re-renders for specific functionality

## Migration Notes

The refactoring was designed to be incremental and non-breaking:
- Core message processing logic remains in the main ChatScreen component for stability
- Extracted components and hooks can be adopted piece by piece
- No changes to external APIs or data structures
- Preserves all existing functionality and bug fixes

## Future Improvements

- Extract remaining ChatScreen logic into smaller hooks
- Add comprehensive unit tests for each hook and component
- Consider extracting message rendering into sub-components
- Add Storybook stories for component development
- Performance profiling and optimization
