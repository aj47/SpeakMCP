---
name: electron-native-mcp
description: "Configure Codex to use a local electron-native Electron MCP server. Use when asked to add, update, or fix the electron-native/electron-mcp-server entry in ~/.codex/config.toml, especially for local dist/index.js paths."
---

# Electron Native MCP

## Overview

Use this skill to configure Codex MCP settings for `electron-native` with an idempotent script.
This skill bootstraps MCP config and validation; it does not replace MCP tools.

## Workflow

1. Locate a local Electron MCP server repository.
- Search common paths:
```bash
find ~/Development -maxdepth 4 -type d \( -name "electron-native-mcp" -o -name "electron-mcp-server" \)
```
- Expected server entrypoint after build: `<repo>/dist/index.js`

2. Build the server if needed.
- If `dist/index.js` is missing, run in that repository:
```bash
npm install && npm run build
```

3. Upsert Codex MCP config.
- Run:
```bash
node scripts/upsert_codex_mcp_config.mjs --script-path /absolute/path/to/dist/index.js
```
- Optional flags:
```bash
node scripts/upsert_codex_mcp_config.mjs \
  --config-path ~/.codex/config.toml \
  --server-name electron-native \
  --command node \
  --script-path /absolute/path/to/dist/index.js
```

4. Validate final config.
- Confirm `electron-native` section exists:
```bash
rg -n "^\[mcp_servers\.electron-native\]|^command = \"node\"|dist/index\.js" ~/.codex/config.toml
```

## Script

Use `scripts/upsert_codex_mcp_config.mjs`.
- Idempotent: one stable `[mcp_servers.electron-native]` block.
- Replaces stale `electron-native` blocks.
- Preserves all unrelated config in `~/.codex/config.toml`.
