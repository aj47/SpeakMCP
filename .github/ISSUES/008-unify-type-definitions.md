# [Refactor] Unify type definitions into shared package

## Problem

Type definitions are split between two locations:
- `/apps/desktop/src/shared/types.ts` (590 LOC) - Desktop-specific types
- `/packages/shared/src/types.ts` (80 LOC) - Cross-platform types

This causes:
- Confusion about where types belong
- Duplication when mobile needs similar types
- Inconsistent naming conventions
- Import path confusion

## Current State

**Desktop types.ts includes:**
- `Config` - Application configuration
- `MCPConfig`, `MCPServerConfig` - MCP server definitions
- `Conversation`, `ConversationMessage` - Chat history
- `Profile`, `ProfilesData` - User profiles
- `AgentProgressUpdate`, `AgentProgressStep` - Agent mode
- `RecordingHistoryItem` - Recording history
- And many more...

**Shared types.ts includes:**
- `BaseChatMessage` - Base message type
- `ToolCall`, `ToolResult` - Tool execution types
- Basic shared primitives

## Proposed Solution

Consolidate types into the shared package with clear organization:

```
packages/shared/src/
├── types/
│   ├── index.ts              # Re-exports all types
│   ├── config.ts             # Config, MCPConfig, etc.
│   ├── conversation.ts       # Conversation, Message types
│   ├── mcp.ts                # MCP-specific types
│   ├── agent.ts              # Agent mode types
│   ├── profile.ts            # Profile types
│   └── common.ts             # Shared primitives
└── index.ts                  # Package entry point
```

### Type Organization

```typescript
// types/config.ts
export interface Config {
  // Core settings
  openaiApiKey?: string
  groqApiKey?: string
  // ... moved from desktop types.ts
}

// types/mcp.ts
export interface MCPServerConfig {
  command?: string
  args?: string[]
  url?: string
  transport?: MCPTransportType
  // ...
}

// types/conversation.ts
export interface Conversation {
  id: string
  title: string
  messages: ConversationMessage[]
  // ...
}
```

### Migration Strategy

1. Move types to shared package
2. Update desktop imports: `import { Config } from '@speakmcp/shared'`
3. Keep desktop-ONLY types in desktop (if truly desktop-specific)
4. Update mobile to use shared types

## Benefits

- **Single Source of Truth**: All types in one place
- **Cross-Platform Consistency**: Mobile and desktop share types
- **Better Discoverability**: Find types in one location
- **Easier Refactoring**: Change type once, updates everywhere
- **Type Safety**: Shared package ensures compatibility

## Acceptance Criteria

- [ ] Create `types/` directory in shared package
- [ ] Migrate `Config` and related types
- [ ] Migrate `MCPConfig`, `MCPServerConfig`
- [ ] Migrate `Conversation`, `ConversationMessage`
- [ ] Migrate `Profile`, `ProfilesData`
- [ ] Migrate `AgentProgressUpdate`
- [ ] Update desktop imports
- [ ] Update mobile imports (if applicable)
- [ ] Remove duplicate types from desktop
- [ ] Add type documentation
- [ ] Build passes for all packages

## Labels

`refactor`, `tech-debt`, `types`, `shared-package`
