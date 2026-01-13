# SpeakMCP Filesystem MCP Server

A simplified filesystem MCP server for SpeakMCP with reduced redundancy. This server provides 9 essential file operation tools, down from the 14 tools in `@modelcontextprotocol/server-filesystem`.

## Features

- **9 essential tools** - Streamlined interface for better agent experience
- **Reduced redundancy** - No deprecated or rarely-used tools
- **Merged functionality** - `list_directory` includes optional size information
- **Cross-platform** - Works on macOS, Linux, and Windows
- **Security** - Path validation ensures access only to allowed directories

## Tools

| Tool | Description |
|------|-------------|
| `read_text_file` | Read file contents with optional head/tail |
| `read_media_file` | Read images/audio as base64 |
| `write_file` | Create or overwrite files |
| `edit_file` | Make text replacements in files |
| `create_directory` | Create directories (including nested) |
| `list_directory` | List directory contents with optional sizes |
| `move_file` | Move or rename files/directories |
| `search_files` | Search for files by glob pattern |
| `list_allowed_directories` | Show accessible directories |

## Removed Tools (compared to @modelcontextprotocol/server-filesystem)

- `read_file` - Deprecated, use `read_text_file` instead
- `read_multiple_files` - Unnecessary, call `read_text_file` multiple times
- `directory_tree` - Rarely used
- `get_file_info` - Rarely used
- `list_directory_with_sizes` - Merged into `list_directory` with `includeSizes` param

## Usage

```bash
# Run directly
node dist/index.js /path/to/allowed/directory

# Multiple directories
node dist/index.js /path/one /path/two
```

## Configuration in SpeakMCP

This server is automatically configured as `speakmcp-filesystem` when SpeakMCP starts, pointing to the skills folder.

## Building

```bash
pnpm build
```

## Development

```bash
pnpm dev
```

