# [Refactor] Decompose agent-progress.tsx into smaller components

## Problem

`agent-progress.tsx` is **2,309 LOC** handling multiple UI concerns:
- Progress step visualization
- Tool call display with approval buttons
- Conversation history rendering
- Streaming markdown content
- Collapsible sections
- Copy/export functionality
- Retry status display
- Scroll management

This monolithic component is hard to maintain and test.

## Current State

The component handles:
- ~12 different UI states
- Inline markdown rendering
- Complex conditional rendering
- Multiple animation states
- Mixed concerns (display + interaction + state)

## Proposed Solution

Split into focused, composable components:

```
apps/desktop/src/renderer/src/components/agent-progress/
├── index.tsx                    # Main container
├── ProgressSteps/
│   ├── index.tsx                # Steps container
│   ├── StepItem.tsx             # Individual step
│   ├── StepIcon.tsx             # Status icons
│   └── StepContent.tsx          # Step details
├── ToolExecution/
│   ├── index.tsx                # Tool call container
│   ├── ToolCallCard.tsx         # Tool call display
│   ├── ToolApproval.tsx         # Approve/deny buttons
│   ├── ToolResult.tsx           # Result display
│   └── ArgumentsView.tsx        # JSON args viewer
├── Conversation/
│   ├── index.tsx                # Conversation container
│   ├── MessageBubble.tsx        # Individual message
│   ├── UserMessage.tsx          # User message styling
│   └── AssistantMessage.tsx     # Assistant with markdown
├── StreamingContent/
│   ├── index.tsx                # Streaming text handler
│   └── MarkdownStream.tsx       # Progressive markdown render
├── Controls/
│   ├── CopyButton.tsx           # Copy to clipboard
│   ├── ExportButton.tsx         # Export conversation
│   └── RetryIndicator.tsx       # Retry status display
└── hooks/
    ├── useScrollManagement.ts   # Auto-scroll logic
    ├── useCollapsible.ts        # Expand/collapse state
    └── useProgressState.ts      # Progress state management
```

### Example Split

```tsx
// ToolExecution/ToolApproval.tsx (~80 LOC)
export function ToolApproval({ toolName, args, onApprove, onDeny }) {
  return (
    <div className="tool-approval">
      <h4>Approve tool execution?</h4>
      <code>{toolName}</code>
      <ArgumentsView args={args} />
      <div className="actions">
        <Button onClick={onApprove}>Approve</Button>
        <Button variant="destructive" onClick={onDeny}>Deny</Button>
      </div>
    </div>
  )
}

// hooks/useScrollManagement.ts (~50 LOC)
export function useScrollManagement(containerRef, isStreaming) {
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [isStreaming])
}
```

## Benefits

- **Composability**: Mix and match components for different views
- **Testing**: Unit test each component independently
- **Performance**: Only re-render changed components
- **Reusability**: MessageBubble, CopyButton etc. usable elsewhere
- **Readability**: Each file has single purpose

## Acceptance Criteria

- [ ] Create `agent-progress/` directory structure
- [ ] Extract ProgressSteps components
- [ ] Extract ToolExecution components
- [ ] Extract Conversation components
- [ ] Extract StreamingContent components
- [ ] Extract Control components
- [ ] Extract hooks
- [ ] Main index.tsx is composition only (~200 LOC max)
- [ ] Add component tests
- [ ] No component exceeds 300 LOC

## Labels

`refactor`, `tech-debt`, `ui`, `react`
