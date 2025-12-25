# [Refactor] Split keyboard.ts into focused modules

## Problem

`keyboard.ts` is **1,169 LOC** handling multiple unrelated concerns:
- Hold-to-record mode
- Toggle recording mode
- Custom keyboard shortcuts
- Text injection (via Rust binary)
- Keybind registration/unregistration
- Recording state management
- Focus management

This makes it difficult to:
- Understand any single feature
- Test recording modes independently
- Modify text injection without affecting shortcuts

## Current State

```
keyboard.ts:
├── Shortcut registration/management
├── Hold-to-record logic
│   ├── Key down handling
│   ├── Key up handling
│   └── Timing logic
├── Toggle recording logic
│   ├── State toggling
│   └── Visual feedback
├── Text injection
│   ├── Rust binary communication
│   ├── Clipboard fallback
│   └── Focus restoration
├── Recording state machine
└── Platform-specific handling
```

## Proposed Solution

Split by feature/concern:

```
apps/desktop/src/main/keyboard/
├── index.ts                  # Public API
├── shortcuts.ts              # Keybind registration (~200 LOC)
│   ├── registerShortcut()
│   ├── unregisterShortcut()
│   └── Platform abstraction
├── recording-modes/
│   ├── index.ts
│   ├── hold-mode.ts          # Hold-to-record (~200 LOC)
│   └── toggle-mode.ts        # Toggle recording (~150 LOC)
├── text-injection.ts         # Text output (~250 LOC)
│   ├── Rust binary interface
│   ├── Clipboard fallback
│   └── Focus management
├── state.ts                  # Recording state machine (~100 LOC)
└── types.ts                  # Keyboard-related types
```

### Example Split

```typescript
// recording-modes/hold-mode.ts
export class HoldRecordingMode {
  private isHolding = false
  private holdStartTime = 0

  onKeyDown(key: string) {
    if (key === this.triggerKey && !this.isHolding) {
      this.isHolding = true
      this.holdStartTime = Date.now()
      this.startRecording()
    }
  }

  onKeyUp(key: string) {
    if (key === this.triggerKey && this.isHolding) {
      this.isHolding = false
      this.stopRecording()
    }
  }
}

// text-injection.ts
export async function writeText(text: string): Promise<void> {
  try {
    await writeTextViaRust(text)
  } catch (error) {
    await writeTextViaClipboard(text)
  }
}
```

## Benefits

- **Clear Separation**: Each file has one responsibility
- **Testable Modes**: Test hold vs toggle independently
- **Isolated Changes**: Modify text injection without touching shortcuts
- **Reusable**: Text injection could be used by other features
- **Smaller Files**: Max 250 LOC per file

## Acceptance Criteria

- [ ] Create `keyboard/` directory structure
- [ ] Extract shortcut registration
- [ ] Extract hold-to-record mode
- [ ] Extract toggle recording mode
- [ ] Extract text injection
- [ ] Extract state machine
- [ ] Update all imports
- [ ] Add unit tests for each module
- [ ] No file exceeds 300 LOC

## Labels

`refactor`, `tech-debt`, `keyboard`
