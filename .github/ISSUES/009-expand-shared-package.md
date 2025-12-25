# [Enhancement] Expand shared package utilities

## Problem

The shared package (`/packages/shared/`) is underutilized, exporting only 4 modules:
- `colors.ts` - Color tokens
- `types.ts` - Basic types
- `tts-preprocessing.ts` - TTS text processing
- `chat-utils.ts` - Chat UI utilities

Meanwhile, the desktop app has many utilities that could be shared:
- Validation schemas
- Date/time formatting
- Text processing
- Configuration helpers
- Common hooks patterns

## Current State

```
packages/shared/src/
├── index.ts           # 12 LOC - just re-exports
├── types.ts           # 80 LOC - basic types
├── colors.ts          # Color tokens
├── chat-utils.ts      # 466 LOC - chat utilities
└── tts-preprocessing.ts # 205 LOC - TTS processing
```

**Desktop has utilities that could be shared:**
- `apps/desktop/src/shared/mcp-utils.ts` - MCP config normalization
- `apps/desktop/src/shared/key-utils.ts` - Keyboard utilities
- Various inline validation logic
- Date formatting scattered throughout

## Proposed Solution

Expand the shared package with commonly-needed utilities:

```
packages/shared/src/
├── index.ts
├── types/                    # Consolidated types (see issue #008)
├── colors.ts
├── chat-utils.ts
├── tts-preprocessing.ts
├── validation/
│   ├── index.ts
│   ├── config.ts             # Config validation schemas
│   ├── mcp.ts                # MCP config validation
│   └── common.ts             # Common validators
├── formatting/
│   ├── index.ts
│   ├── date.ts               # Date/time formatting
│   ├── duration.ts           # Duration formatting
│   └── bytes.ts              # File size formatting
├── mcp/
│   ├── index.ts
│   ├── utils.ts              # MCP utilities (from desktop)
│   └── transport.ts          # Transport type inference
└── text/
    ├── index.ts
    ├── truncate.ts           # Text truncation
    └── sanitize.ts           # Text sanitization
```

### Example Utilities to Add

```typescript
// formatting/date.ts
export function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('default', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(ts))
}

export function formatRelativeTime(ts: number): string {
  const rtf = new Intl.RelativeTimeFormat('default')
  const diff = Date.now() - ts
  // ... relative time logic
}

// validation/mcp.ts
export function validateMCPServerConfig(config: unknown): ValidationResult {
  // Zod or manual validation
}

// mcp/utils.ts (moved from desktop)
export function inferTransportType(config: MCPServerConfig): MCPTransportType {
  if (config.url?.startsWith('ws://') || config.url?.startsWith('wss://')) {
    return 'websocket'
  }
  // ...
}
```

## Benefits

- **Code Reuse**: Desktop and mobile share utilities
- **Consistency**: Same formatting/validation across platforms
- **Reduced Duplication**: One implementation, multiple consumers
- **Better Testing**: Test utilities once in shared package
- **Easier Maintenance**: Update in one place

## Acceptance Criteria

- [ ] Add validation module with config validators
- [ ] Add formatting module (date, duration, bytes)
- [ ] Move mcp-utils.ts to shared package
- [ ] Add text processing utilities
- [ ] Update desktop imports
- [ ] Update mobile imports (if applicable)
- [ ] Add unit tests for all utilities
- [ ] Document all exported utilities
- [ ] Update package.json exports

## Labels

`enhancement`, `shared-package`, `utilities`
