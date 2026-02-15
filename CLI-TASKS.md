# SpeakMCP Rust CLI - Task Breakdown

This document breaks down the PRD into the smallest achievable tasks for implementing feature parity in the Rust CLI.

**Legend:**
- `[API]` = Remote server endpoint already exists
- `[NEW-API]` = Needs new remote server endpoint
- `[CLI]` = CLI implementation only
- `[RUST]` = Rust code changes
- `[TS]` = TypeScript server changes

---

## Phase 0: Infrastructure & Foundation

### 0.1 Project Structure
- [ ] **[RUST]** Create `commands/` module directory for subcommand handlers
- [ ] **[RUST]** Create `commands/mod.rs` with public exports
- [ ] **[RUST]** Move `send_message()` to `commands/send.rs`
- [ ] **[RUST]** Move `check_status()` to `commands/status.rs`
- [ ] **[RUST]** Move `handle_config()` to `commands/config.rs`
- [ ] **[RUST]** Create `types.rs` for shared response types

### 0.2 API Client Enhancements
- [ ] **[RUST]** Add generic `get<T>()` method to `ApiClient`
- [ ] **[RUST]** Add generic `post<T, R>()` method to `ApiClient`
- [ ] **[RUST]** Add `patch<T, R>()` method to `ApiClient`
- [ ] **[RUST]** Add `put<T, R>()` method to `ApiClient`
- [ ] **[RUST]** Add error type enum for API errors (401, 404, 500, network)
- [ ] **[RUST]** Add retry logic with configurable attempts

### 0.3 Output Formatting
- [ ] **[RUST]** Create `output.rs` module for formatting helpers
- [ ] **[RUST]** Add `print_table()` function for tabular data
- [ ] **[RUST]** Add `print_json()` function for JSON output mode
- [ ] **[RUST]** Add `--json` global flag for machine-readable output
- [ ] **[RUST]** Add `--quiet` global flag for minimal output

---

## Phase 1: MCP Server Management (High Priority)

### 1.1 List MCP Servers
**Endpoint:** `GET /v1/mcp/servers` [API EXISTS]

- [ ] **[RUST]** Add `servers` subcommand to CLI parser
- [ ] **[RUST]** Add `servers list` subcommand
- [ ] **[RUST]** Create `commands/servers.rs` module
- [ ] **[RUST]** Define `McpServer` struct matching API response
- [ ] **[RUST]** Implement `list_servers()` function
- [ ] **[RUST]** Format server list as table (name, status, tools, enabled)
- [ ] **[RUST]** Add color coding for status (green=connected, red=error, gray=disabled)
- [ ] **[RUST]** Add `--json` output support for servers list

### 1.2 Toggle MCP Server
**Endpoint:** `POST /v1/mcp/servers/:name/toggle` [API EXISTS]

- [ ] **[RUST]** Add `servers enable <name>` subcommand
- [ ] **[RUST]** Add `servers disable <name>` subcommand
- [ ] **[RUST]** Implement `toggle_server()` function
- [ ] **[RUST]** Add confirmation message on success
- [ ] **[RUST]** Add error handling for server not found

### 1.3 Server Status Details
**Endpoint:** Needs enhancement or new endpoint [NEW-API]

- [ ] **[TS]** Add `GET /v1/mcp/servers/:name` endpoint for single server details
- [ ] **[TS]** Include server config (transport, command/url) in response
- [ ] **[TS]** Include tool list for that server
- [ ] **[RUST]** Add `servers info <name>` subcommand
- [ ] **[RUST]** Display server config, status, and tool list

---

## Phase 2: Profile Management (High Priority)

### 2.1 List Profiles
**Endpoint:** `GET /v1/profiles` [API EXISTS]

- [ ] **[RUST]** Add `profiles` subcommand to CLI parser
- [ ] **[RUST]** Add `profiles list` subcommand
- [ ] **[RUST]** Create `commands/profiles.rs` module
- [ ] **[RUST]** Define `Profile` struct matching API response
- [ ] **[RUST]** Implement `list_profiles()` function
- [ ] **[RUST]** Format profile list as table (name, isDefault, isCurrent)
- [ ] **[RUST]** Highlight current profile with asterisk or color
- [ ] **[RUST]** Add `--json` output support

### 2.2 Get Current Profile
**Endpoint:** `GET /v1/profiles/current` [API EXISTS]

- [ ] **[RUST]** Add `profiles current` subcommand
- [ ] **[RUST]** Implement `get_current_profile()` function
- [ ] **[RUST]** Display profile name, guidelines preview, system prompt preview

### 2.3 Switch Profile
**Endpoint:** `POST /v1/profiles/current` [API EXISTS]

- [ ] **[RUST]** Add `profiles switch <name>` subcommand
- [ ] **[RUST]** Implement `switch_profile()` function
- [ ] **[RUST]** Add confirmation message on success
- [ ] **[RUST]** Support switching by name (fuzzy match) or ID

### 2.4 Export Profile
**Endpoint:** `GET /v1/profiles/:id/export` [API EXISTS]

- [ ] **[RUST]** Add `profiles export <name> [--output <file>]` subcommand
- [ ] **[RUST]** Implement `export_profile()` function
- [ ] **[RUST]** Write JSON to stdout or file

### 2.5 Import Profile
**Endpoint:** `POST /v1/profiles/import` [API EXISTS]

- [ ] **[RUST]** Add `profiles import <file>` subcommand
- [ ] **[RUST]** Add `profiles import -` for stdin
- [ ] **[RUST]** Implement `import_profile()` function
- [ ] **[RUST]** Validate JSON before sending
- [ ] **[RUST]** Add confirmation message on success

---

## Phase 3: Tool Management (Medium Priority)

### 3.1 List All Tools
**Endpoint:** `POST /mcp/tools/list` [API EXISTS - returns builtin only]

- [ ] **[TS]** Add `GET /v1/tools` endpoint listing ALL tools (builtin + MCP)
- [ ] **[TS]** Include server name, enabled status, description for each tool
- [ ] **[RUST]** Add `tools` subcommand to CLI parser
- [ ] **[RUST]** Add `tools list` subcommand
- [ ] **[RUST]** Create `commands/tools.rs` module
- [ ] **[RUST]** Define `Tool` struct
- [ ] **[RUST]** Implement `list_tools()` function
- [ ] **[RUST]** Format tool list as table (name, server, enabled)
- [ ] **[RUST]** Add `--server <name>` filter option
- [ ] **[RUST]** Add `--enabled` / `--disabled` filter options

### 3.2 Tool Details
- [ ] **[TS]** Add `GET /v1/tools/:name` endpoint for tool schema
- [ ] **[RUST]** Add `tools info <name>` subcommand
- [ ] **[RUST]** Display tool description and input schema
- [ ] **[RUST]** Format schema in human-readable way

### 3.3 Call Tool Directly
**Endpoint:** `POST /mcp/tools/call` [API EXISTS - builtin only]

- [ ] **[TS]** Extend `/mcp/tools/call` to support MCP server tools
- [ ] **[RUST]** Add `tools call <name> [--arg key=value]...` subcommand
- [ ] **[RUST]** Add `tools call <name> --json <json>` for complex args
- [ ] **[RUST]** Implement `call_tool()` function
- [ ] **[RUST]** Display tool result with success/error indication

---

## Phase 4: Conversation Management (Medium Priority)

### 4.1 List Conversations
**Endpoint:** `GET /v1/conversations` [API EXISTS]

- [ ] **[RUST]** Add `history` subcommand to CLI parser
- [ ] **[RUST]** Add `history list` subcommand (default)
- [ ] **[RUST]** Create `commands/history.rs` module
- [ ] **[RUST]** Define `ConversationSummary` struct
- [ ] **[RUST]** Implement `list_conversations()` function
- [ ] **[RUST]** Format as table (id, title, date, message count)
- [ ] **[RUST]** Add `--limit <n>` option (default 20)
- [ ] **[RUST]** Add `--json` output support

### 4.2 View Conversation
**Endpoint:** `GET /v1/conversations/:id` [API EXISTS]

- [ ] **[RUST]** Add `history show <id>` subcommand
- [ ] **[RUST]** Implement `show_conversation()` function
- [ ] **[RUST]** Display messages with role indicators (user/assistant/tool)
- [ ] **[RUST]** Display tool calls inline with results
- [ ] **[RUST]** Add `--last <n>` option to show only last N messages
- [ ] **[RUST]** Add color coding for roles

### 4.3 Continue Conversation (existing)
- [ ] **[RUST]** Add `history continue <id>` subcommand
- [ ] **[RUST]** Implement as alias for `speakmcp chat --conversation <id>`

### 4.4 Delete Conversation
- [ ] **[TS]** Add `DELETE /v1/conversations/:id` endpoint
- [ ] **[RUST]** Add `history delete <id>` subcommand
- [ ] **[RUST]** Add `--force` flag to skip confirmation
- [ ] **[RUST]** Implement `delete_conversation()` function

### 4.5 Export Conversation
- [ ] **[RUST]** Add `history export <id> [--output <file>]` subcommand
- [ ] **[RUST]** Export as JSON (reuse existing endpoint)
- [ ] **[RUST]** Add `--format markdown` option for human-readable export

---

## Phase 5: Settings Management (Medium Priority)

### 5.1 Show Settings
**Endpoint:** `GET /v1/settings` [API EXISTS]

- [ ] **[RUST]** Add `settings` subcommand to CLI parser
- [ ] **[RUST]** Add `settings show` subcommand (default)
- [ ] **[RUST]** Create `commands/settings.rs` module
- [ ] **[RUST]** Define `Settings` struct
- [ ] **[RUST]** Implement `show_settings()` function
- [ ] **[RUST]** Format as key-value list
- [ ] **[RUST]** Add `--json` output support

### 5.2 Update Settings
**Endpoint:** `PATCH /v1/settings` [API EXISTS]

- [ ] **[RUST]** Add `settings set <key> <value>` subcommand
- [ ] **[RUST]** Implement `set_setting()` function
- [ ] **[RUST]** Validate key is in allowed list
- [ ] **[RUST]** Parse value based on expected type (bool, int, string)
- [ ] **[RUST]** Add confirmation message

### 5.3 Model Selection
- [ ] **[RUST]** Add `settings model` subcommand group
- [ ] **[RUST]** Add `settings model list` to show available models
- [ ] **[RUST]** Add `settings model set <model>` to set agent model
- [ ] **[RUST]** Add `settings provider set <provider>` for provider selection

---

## Phase 6: Emergency Stop (Medium Priority)

### 6.1 Stop Command
**Endpoint:** `POST /v1/emergency-stop` [API EXISTS]

- [ ] **[RUST]** Add `stop` subcommand to CLI parser
- [ ] **[RUST]** Create `commands/stop.rs` module
- [ ] **[RUST]** Implement `emergency_stop()` function
- [ ] **[RUST]** Display processes killed count
- [ ] **[RUST]** Add `--force` flag (no confirmation)

---

## Phase 7: Streaming Responses (Medium Priority)

### 7.1 SSE Client
- [ ] **[RUST]** Add `reqwest-eventsource` or similar SSE crate to Cargo.toml
- [ ] **[RUST]** Create `sse.rs` module for SSE handling
- [ ] **[RUST]** Implement `SseClient` struct
- [ ] **[RUST]** Handle `progress`, `done`, `error` event types

### 7.2 Streaming Chat
- [ ] **[RUST]** Add `--stream` flag to `send` command
- [ ] **[RUST]** Add `--stream` flag to REPL (default on)
- [ ] **[RUST]** Update `chat()` to support `stream=true` in request
- [ ] **[RUST]** Display progress updates (tool calls) as they happen
- [ ] **[RUST]** Display streaming text as it arrives

### 7.3 Progress Display
- [ ] **[RUST]** Create `progress.rs` module for progress display
- [ ] **[RUST]** Implement spinner for long operations
- [ ] **[RUST]** Display tool call names as they execute
- [ ] **[RUST]** Show iteration count (1/10, 2/10, etc.)

---

## Phase 8: Memory Management (Low Priority)

### 8.1 API Endpoints
- [ ] **[TS]** Add `GET /v1/memories` endpoint
- [ ] **[TS]** Add `GET /v1/memories/:id` endpoint
- [ ] **[TS]** Add `POST /v1/memories` endpoint
- [ ] **[TS]** Add `DELETE /v1/memories/:id` endpoint
- [ ] **[TS]** Add `DELETE /v1/memories` (bulk) endpoint

### 8.2 List Memories
- [ ] **[RUST]** Add `memories` subcommand to CLI parser
- [ ] **[RUST]** Add `memories list` subcommand
- [ ] **[RUST]** Create `commands/memories.rs` module
- [ ] **[RUST]** Format as table (id, importance, content preview, date)
- [ ] **[RUST]** Add `--importance <level>` filter
- [ ] **[RUST]** Add `--limit <n>` option

### 8.3 View Memory
- [ ] **[RUST]** Add `memories show <id>` subcommand
- [ ] **[RUST]** Display full memory content and metadata

### 8.4 Create Memory
- [ ] **[RUST]** Add `memories add <content>` subcommand
- [ ] **[RUST]** Add `--importance <level>` option
- [ ] **[RUST]** Add `--tags <tags>` option

### 8.5 Delete Memory
- [ ] **[RUST]** Add `memories delete <id>` subcommand
- [ ] **[RUST]** Add `--force` flag

---

## Phase 9: Advanced Features (Low Priority)

### 9.1 Model Presets
- [ ] **[RUST]** Add `presets` subcommand group
- [ ] **[RUST]** Add `presets list` subcommand
- [ ] **[RUST]** Add `presets use <id>` subcommand

### 9.2 Available Models Query
**Endpoint:** `GET /v1/models/:providerId` [API EXISTS]

- [ ] **[RUST]** Add `models` subcommand to CLI parser
- [ ] **[RUST]** Add `models list [--provider <id>]` subcommand
- [ ] **[RUST]** Display model names and context lengths

### 9.3 Diagnostics
- [ ] **[TS]** Add `GET /v1/diagnostics` endpoint
- [ ] **[RUST]** Add `diagnostics` subcommand
- [ ] **[RUST]** Display system health info
- [ ] **[RUST]** Add `--export <file>` option

---

## Phase 10: UX Improvements (Low Priority)

### 10.1 Shell Completions
- [ ] **[RUST]** Add `completions` subcommand
- [ ] **[RUST]** Generate completions for bash
- [ ] **[RUST]** Generate completions for zsh
- [ ] **[RUST]** Generate completions for fish
- [ ] **[RUST]** Generate completions for PowerShell

### 10.2 Man Pages
- [ ] **[RUST]** Add `clap_mangen` crate
- [ ] **[RUST]** Generate man pages during build

### 10.3 Config Wizard
- [ ] **[RUST]** Add `config wizard` subcommand
- [ ] **[RUST]** Interactive prompts for server URL
- [ ] **[RUST]** Interactive prompts for API key
- [ ] **[RUST]** Validate connection before saving

### 10.4 REPL Improvements
- [ ] **[RUST]** Add command history persistence
- [ ] **[RUST]** Add tab completion for commands
- [ ] **[RUST]** Add `/profile <name>` command to switch in REPL
- [ ] **[RUST]** Add `/servers` command to list servers in REPL
- [ ] **[RUST]** Add `/tools` command to list tools in REPL

---

## Task Summary by Priority

### High Priority (29 tasks)
- Phase 1: MCP Server Management (11 tasks)
- Phase 2: Profile Management (18 tasks)

### Medium Priority (48 tasks)
- Phase 3: Tool Management (12 tasks)
- Phase 4: Conversation Management (14 tasks)
- Phase 5: Settings Management (10 tasks)
- Phase 6: Emergency Stop (4 tasks)
- Phase 7: Streaming Responses (8 tasks)

### Low Priority (27 tasks)
- Phase 8: Memory Management (12 tasks)
- Phase 9: Advanced Features (7 tasks)
- Phase 10: UX Improvements (8 tasks)

### Infrastructure (17 tasks)
- Phase 0: Foundation (17 tasks)

---

## Dependency Graph

```
Phase 0 (Foundation)
    ↓
Phase 1 (Servers) ←→ Phase 2 (Profiles)
    ↓                    ↓
Phase 3 (Tools)     Phase 5 (Settings)
    ↓                    ↓
Phase 4 (History)   Phase 6 (Stop)
    ↓
Phase 7 (Streaming)
    ↓
Phase 8 (Memories)
    ↓
Phase 9 (Advanced)
    ↓
Phase 10 (UX)
```

---

## Quick Wins (Can be done immediately)

These tasks use existing API endpoints and require minimal code:

1. **`servers list`** - GET /v1/mcp/servers exists
2. **`servers enable/disable`** - POST /v1/mcp/servers/:name/toggle exists
3. **`profiles list`** - GET /v1/profiles exists
4. **`profiles switch`** - POST /v1/profiles/current exists
5. **`history list`** - GET /v1/conversations exists
6. **`history show`** - GET /v1/conversations/:id exists
7. **`settings show`** - GET /v1/settings exists
8. **`stop`** - POST /v1/emergency-stop exists

---

## Estimated Effort per Phase

| Phase | Tasks | Est. Hours | Dependencies |
|-------|-------|------------|--------------|
| 0. Foundation | 17 | 4-6h | None |
| 1. Servers | 11 | 3-4h | Phase 0 |
| 2. Profiles | 18 | 4-6h | Phase 0 |
| 3. Tools | 12 | 4-5h | Phase 0, 1 |
| 4. History | 14 | 3-4h | Phase 0 |
| 5. Settings | 10 | 2-3h | Phase 0 |
| 6. Stop | 4 | 1h | Phase 0 |
| 7. Streaming | 8 | 4-6h | Phase 0 |
| 8. Memories | 12 | 4-5h | Phase 0, 7 |
| 9. Advanced | 7 | 2-3h | Phase 1-6 |
| 10. UX | 8 | 3-4h | All |

**Total: ~121 tasks, ~35-50 hours of implementation**

---

## Next Steps

1. Start with **Phase 0** to set up proper project structure
2. Implement **Phase 1** (servers) and **Phase 2** (profiles) in parallel
3. Add **Phase 6** (stop) as it's a quick win with safety benefits
4. Continue with remaining phases based on user feedback

---

## Command Reference (Target State)

```bash
# Chat (existing)
speakmcp                              # Interactive REPL
speakmcp chat                         # Explicit REPL
speakmcp send "message"               # Single message
speakmcp send - < file.txt            # From stdin

# Config (existing)
speakmcp config --show                # Show config
speakmcp config --init                # Initialize
speakmcp config --server-url <url>    # Set server
speakmcp config --api-key <key>       # Set API key

# Status (existing)
speakmcp status                       # Check connection

# Servers (NEW)
speakmcp servers                      # List servers (alias for list)
speakmcp servers list                 # List all MCP servers
speakmcp servers info <name>          # Server details
speakmcp servers enable <name>        # Enable server
speakmcp servers disable <name>       # Disable server

# Profiles (NEW)
speakmcp profiles                     # List profiles (alias for list)
speakmcp profiles list                # List all profiles
speakmcp profiles current             # Show current profile
speakmcp profiles switch <name>       # Switch to profile
speakmcp profiles export <name>       # Export profile JSON
speakmcp profiles import <file>       # Import profile JSON

# Tools (NEW)
speakmcp tools                        # List tools (alias for list)
speakmcp tools list                   # List all tools
speakmcp tools info <name>            # Tool schema
speakmcp tools call <name> [args]     # Call tool

# History (NEW)
speakmcp history                      # List conversations (alias for list)
speakmcp history list                 # List all conversations
speakmcp history show <id>            # View conversation
speakmcp history continue <id>        # Continue conversation
speakmcp history delete <id>          # Delete conversation
speakmcp history export <id>          # Export conversation

# Settings (NEW)
speakmcp settings                     # Show settings (alias for show)
speakmcp settings show                # Show all settings
speakmcp settings set <key> <value>   # Update setting
speakmcp settings model list          # List models
speakmcp settings model set <model>   # Set model

# Memories (NEW)
speakmcp memories                     # List memories
speakmcp memories list                # List all memories
speakmcp memories show <id>           # View memory
speakmcp memories add <content>       # Create memory
speakmcp memories delete <id>         # Delete memory

# Stop (NEW)
speakmcp stop                         # Emergency stop

# Shell Completions (NEW)
speakmcp completions bash             # Generate bash completions
speakmcp completions zsh              # Generate zsh completions
```
