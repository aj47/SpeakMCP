# CLI E2E Testing Reference

Quick reference for future agents working on CLI E2E tests.

## Setup Checklist

```bash
# Fix node-pty permissions (required after pnpm install)
chmod +x node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper

# Kill orphaned server processes
lsof -ti:3299 | xargs kill -9 2>/dev/null || true
```

## Critical Gotchas

| Issue | Solution |
|-------|----------|
| node-pty can't find `bun` | Use absolute path: `~/.bun/bin/bun` or `/opt/homebrew/bin/bun` |
| Server returns 401 despite correct API key | Set `SPEAKMCP_DATA_DIR` to isolate config from existing installation |
| Vitest can't find globalSetup | Use `import.meta.url` + `fileURLToPath` for absolute paths |
| CLI argument is `--url` | NOT `--server` |
| CLI requires Bun runtime | NOT Node.js (due to @opentui/core tree-sitter bindings) |

## Key Escape Sequences

```typescript
const KEYS = {
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
  CTRL_C: '\x03', ENTER: '\r', TAB: '\t', ESCAPE: '\x1b',
  UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D',
}
```

## Config Isolation

```typescript
// Always use isolated data dir for tests
const TEST_DATA_DIR = resolve(tmpdir(), 'speakmcp-e2e-test')
env: { ...process.env, SPEAKMCP_DATA_DIR: TEST_DATA_DIR }
```

## ANSI Stripping

```typescript
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
```

## Config Paths

- macOS: `~/Library/Application Support/speakmcp/config.json`
- Linux: `~/.config/speakmcp/config.json`
- Override: `SPEAKMCP_DATA_DIR` or `SPEAKMCP_CONFIG_PATH`

