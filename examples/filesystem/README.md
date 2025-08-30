# Filesystem MCP Server Example

A simple and safe MCP server that provides file system operations within a sandboxed directory.

## Features

- **Safe Operations**: All file operations are restricted to a sandbox directory
- **Basic File Operations**: Read, write, delete files
- **Directory Management**: List contents, create directories
- **No External Dependencies**: Works completely offline

## Available Tools

### `read_file`
Read the contents of a file in the sandbox directory.

**Parameters:**
- `filename` (string): Name of the file to read (relative to sandbox)

### `write_file`
Write content to a file in the sandbox directory.

**Parameters:**
- `filename` (string): Name of the file to write
- `content` (string): Content to write to the file

### `list_files`
List all files and directories in the sandbox.

**Parameters:**
- `directory` (string, optional): Directory to list (defaults to root)

### `create_directory`
Create a new directory in the sandbox.

**Parameters:**
- `dirname` (string): Name of the directory to create

### `delete_file`
Delete a file from the sandbox directory.

**Parameters:**
- `filename` (string): Name of the file to delete

## Setup Instructions

1. **Install dependencies:**
   ```bash
   cd examples/filesystem
   npm install
   ```

2. **Test the server:**
   ```bash
   npm start
   ```

3. **Configure in SpeakMCP:**
   Add this configuration to your MCP servers:
   ```json
   {
     "filesystem-example": {
       "command": "node",
       "args": ["examples/filesystem/index.js"],
       "env": {}
     }
   }
   ```

## Usage Examples

Once configured in SpeakMCP, you can use voice commands like:

- "Create a file called notes.txt with the content 'Hello World'"
- "Read the contents of notes.txt"
- "List all files in the sandbox"
- "Create a directory called documents"
- "Delete the file notes.txt"

## Security

- All operations are restricted to the `sandbox` subdirectory
- Path traversal attacks are prevented
- No access to system files or directories outside the sandbox

## Sample Files

The server will create a `sandbox` directory when first run. You can pre-populate it with sample files for testing.
