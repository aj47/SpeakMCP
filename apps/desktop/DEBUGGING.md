# SpeakMCP Debugging Guide

## 🔧 Quick Start: Enable Debug Logging

**Always start with debug logging enabled** - this captures LLM calls, tool execution, UI events, and app lifecycle:

```bash
pnpm dev -- -d              # Enable ALL debug logging (recommended)
```

Selective flags:
| Flag | Description |
|------|-------------|
| `--debug-llm` / `-dl` | LLM API calls and responses |
| `--debug-tools` / `-dt` | MCP tool execution |
| `--debug-ui` / `-dui` | UI/renderer console logs |
| `--debug-app` / `-dapp` | App lifecycle events |
| `--debug-keybinds` / `-dk` | Keyboard shortcut handling |

Environment variable alternative: `DEBUG=* pnpm dev`

---

## CDP (Chrome DevTools Protocol)

For browser-style debugging with DevTools:

```bash
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
```

> ⚠️ **Note**: The `--remote-debugging-port` flag must be passed via the `REMOTE_DEBUGGING_PORT` env var,
> not as a CLI argument. Using `pnpm dev -- --remote-debugging-port=9222` will NOT work.

Chrome → `chrome://inspect` → Configure → add `localhost:9222` → inspect

---

## Agent UI Tests (For AI Agents)

After connecting via CDP: `list_electron_targets_electron-native` → `connect_to_electron_target_electron-native`

### Test 1: Click Settings Button
```javascript
// execute_javascript_electron-native
window.location.hash = '/settings/general';
setTimeout(() => document.querySelector('[data-state]')?.click(), 500);
```

### Test 2: Send 'hi' to Agent
```javascript
// execute_javascript_electron-native
await window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'hi', conversationId: null });
```
Verify: `window.electron.ipcRenderer.invoke('getAgentStatus')`

---

## IPC Methods
```javascript
window.electron.ipcRenderer.invoke('emergencyStopAgent')
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: {...} })
window.electron.ipcRenderer.invoke('getAgentSessions')
```
> All procedures in `apps/desktop/src/main/tipc.ts`

---

## Skills Debugging

Skills are instruction files (`SKILL.md`) that get injected into the system prompt to give agents specialized capabilities.

### Check Active Skills
```javascript
// List all skills and their enabled state
await window.electron.ipcRenderer.invoke('getSkills')

// Get skills enabled for current profile
await window.electron.ipcRenderer.invoke('getProfileSkillsConfig')
```

### Skills in LLM Context
When debug logging is enabled (`-d` or `-dl`), you'll see:
```
[DEBUG][LLM] Loading skills for session <id>. enabledSkillIds: [...]
[DEBUG][LLM] Skills instructions loaded: <N> chars
```

The skills instructions appear in the system prompt with this structure:
```
# Active Agent Skills
## Skills Installation Directory: ~/.speakmcp/skills/
## Skill: <name>
**Skill ID:** `<uuid>`
<instructions>
```

### Skills Folder Location
```javascript
// Get the skills folder path (for manual inspection)
// macOS: ~/Library/Application Support/speakmcp/skills/
await window.electron.ipcRenderer.invoke('openSkillsFolder')
```

### Creating/Installing Skills
Skills are loaded from `SKILL.md` files with YAML frontmatter:
```markdown
---
name: my-skill
description: What this skill does
---

Instructions in markdown...
```

### Troubleshooting
- **Skill not loading**: Check if skill is enabled for the current profile in Settings → Skills
- **Skills not appearing**: Run `scanSkillsFolder` to re-scan for new skill files
- **Skill instructions truncated**: Very long skills may be compacted in summarization—keep instructions concise

---

## Mobile App
```bash
pnpm dev:mobile  # Press 'w' for web → localhost:8081
```
