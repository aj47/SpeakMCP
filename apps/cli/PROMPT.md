# Ralph Loop Instructions for SpeakMCP CLI

You are implementing the SpeakMCP CLI, a Rust command-line interface that provides feature parity with the Electron desktop app.

## Your Task

1. **Read** `prd.json` to understand all tasks
2. **Find** the first task where:
   - `passes` is `false`
   - All tasks in `dependencies` have `passes: true`
3. **Implement** that ONE task only
4. **Run** the `verificationCommand` to confirm it passes
5. **Update** `prd.json` setting `passes: true` for the completed task
6. **Log** your progress to `progress.txt`
7. **Stop** and wait for the next iteration

## Important Rules

- **ONE TASK PER ITERATION** - Do not implement multiple tasks
- **VERIFY BEFORE MARKING COMPLETE** - Run the verificationCommand and ensure it succeeds
- **RESPECT DEPENDENCIES** - Never start a task until all its dependencies pass
- **MATCH EXISTING STYLE** - Read `AGENTS.md` and existing code for conventions
- **MINIMAL CHANGES** - Only change what's necessary for the current task
- **NO BREAKING CHANGES** - Existing functionality must continue to work

## File Locations

```
apps/cli/
├── prd.json          # Task definitions (read and update)
├── progress.txt      # Append progress logs here
├── AGENTS.md         # Developer guide and conventions
├── PROMPT.md         # These instructions
├── Cargo.toml        # Dependencies
└── src/              # Source code
```

## Task Selection Algorithm

```python
def find_next_task(tasks):
    for task in sorted(tasks, key=lambda t: t['id']):
        if task['passes']:
            continue
        deps_satisfied = all(
            get_task(dep)['passes']
            for dep in task['dependencies']
        )
        if deps_satisfied:
            return task
    return None  # All tasks complete
```

## Progress Log Format

Append to `progress.txt` after each task:

```
=== Task [ID] ===
Title: [Task Title]
Started: [timestamp]
Completed: [timestamp]
Status: PASS | FAIL
Notes: [Any relevant notes]

```

## Verification Commands

Each task has a `verificationCommand` that must pass:

- **File existence**: `test -f path/to/file`
- **Directory existence**: `test -d path/to/dir`
- **Cargo check**: `cargo check --manifest-path apps/cli/Cargo.toml 2>&1 | grep -q "Finished"`
- **Cargo test**: `cargo test --manifest-path apps/cli/Cargo.toml [test_name]`
- **Grep for content**: `grep -q "pattern" path/to/file`
- **Run and check output**: `cargo run --manifest-path apps/cli/Cargo.toml -- [args] | grep -q "expected"`

## Example Iteration

### 1. Read prd.json
```json
{
  "userStories": [
    {"id": "0.1.1", "passes": true, "dependencies": []},
    {"id": "0.1.2", "passes": false, "dependencies": ["0.1.1"]}
  ]
}
```

### 2. Find Next Task
Task `0.1.2` - dependencies `["0.1.1"]` all pass, and `passes: false`

### 3. Implement
Create/modify files as needed for the task

### 4. Verify
```bash
# Run the verificationCommand
cargo test --manifest-path apps/cli/Cargo.toml test_name
# Exit code 0 = success
```

### 5. Update prd.json
Set `"passes": true` for task `0.1.2`

### 6. Log Progress
```
=== Task 0.1.2 ===
Title: Add list subcommand to MCP servers
Started: 2024-01-15T10:30:00Z
Completed: 2024-01-15T10:45:00Z
Status: PASS
Notes: Added mcp servers list command with JSON output support
```

### 7. Stop
Wait for next iteration

## Phase Overview

| Phase | Description |
|-------|-------------|
| 0 | Infrastructure - Module structure, shared types |
| 1 | Core API - ApiClient methods for all endpoints |
| 2 | MCP Commands - Server management CLI |
| 3 | Tool Commands - Tool listing and execution |
| 4 | Conversation Commands - History management |
| 5 | Profile Commands - Profile switching |
| 6 | Settings Commands - Settings management |
| 7 | Enhanced REPL - Advanced interactive features |
| 8 | Streaming & Output - SSE, progress, formatting |
| 9 | Final Testing - Integration tests, polish |

## Code Quality Checklist

Before marking a task complete:

- [ ] Code compiles (`cargo check`)
- [ ] Tests pass (`cargo test`)
- [ ] No clippy warnings (`cargo clippy`)
- [ ] Code is formatted (`cargo fmt --check`)
- [ ] Verification command passes
- [ ] Existing functionality still works

## Getting Help

- Read `AGENTS.md` for code conventions
- Check existing code in `src/` for patterns
- Reference the desktop app in `apps/desktop/src/main/` for API details
- See `apps/desktop/src/main/remote-server.ts` for endpoint specs
