# SpeakMCP CLI Developer Guide

## Build Commands

```bash
# Build the CLI
cd apps/cli
cargo build

# Build release version
cargo build --release

# Run tests
cargo test

# Run a specific test
cargo test test_name

# Check without building
cargo check

# Format code
cargo fmt

# Run clippy lints
cargo clippy

# Run the CLI directly
cargo run -- [subcommand] [args]

# Examples
cargo run -- chat                    # Start REPL
cargo run -- send "hello"            # Send message
cargo run -- config show             # Show config
cargo run -- status                  # Check connection
```

## Project Structure

```
apps/cli/
├── Cargo.toml              # Dependencies and metadata
├── prd.json                # Task definitions for Ralph Loop
├── progress.txt            # Progress tracking
├── AGENTS.md               # This file
├── PROMPT.md               # Ralph Loop instructions
└── src/
    ├── main.rs             # Entry point, CLI argument parsing (clap)
    ├── api.rs              # HTTP client for remote server API
    ├── config.rs           # Configuration management (TOML)
    ├── repl.rs             # Interactive REPL mode
    └── commands/           # Subcommand implementations (to be created)
        ├── mod.rs          # Module exports
        ├── chat.rs         # Chat/REPL command
        ├── send.rs         # Send single message
        ├── config.rs       # Config subcommands
        ├── status.rs       # Connection status
        ├── mcp.rs          # MCP server management
        ├── tools.rs        # Tool listing and execution
        ├── conversations.rs # Conversation management
        ├── profiles.rs     # Profile management
        └── settings.rs     # Settings management
```

## Code Conventions

### Error Handling
```rust
use anyhow::{Result, Context};

// Use anyhow::Result for all fallible functions
pub fn do_something() -> Result<()> {
    let value = risky_operation()
        .context("Failed to perform risky operation")?;
    Ok(())
}
```

### Module Documentation
```rust
//! Module-level documentation using `//!`
//!
//! Describes what this module does.

/// Function-level documentation using `///`
pub fn function_name() -> Result<()> {
    // Implementation
}
```

### Struct Definitions
```rust
use serde::{Deserialize, Serialize};

/// Brief description of the struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyStruct {
    /// Field documentation
    pub field_name: String,

    /// Optional fields use Option<T>
    #[serde(default)]
    pub optional_field: Option<String>,
}
```

### CLI Arguments (clap)
```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "speakmcp")]
#[command(about = "Description")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Global flag example
    #[arg(short, long, global = true)]
    pub verbose: bool,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Subcommand description
    SubCmd {
        /// Argument description
        #[arg(short, long)]
        flag: bool,
    },
}
```

### API Client Pattern
```rust
impl ApiClient {
    pub async fn method_name(&self, param: &str) -> Result<ResponseType> {
        let url = format!("{}/endpoint", self.server_url);

        let response = self.client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .context("Failed to send request")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Request failed ({}): {}", status, body);
        }

        response.json().await.context("Failed to parse response")
    }
}
```

### Terminal Output
```rust
use colored::Colorize;

// Prompts and labels
println!("{} {}", "label>".cyan().bold(), content);

// Success messages
println!("{}", "Success!".green());

// Error messages
println!("{}", format!("Error: {}", e).red());

// Dimmed/secondary text
println!("{}", "hint text".dimmed());

// Warnings
println!("{}", "Warning message".yellow());
```

### JSON Output Mode
```rust
// Support --json flag for machine-readable output
if args.json {
    println!("{}", serde_json::to_string_pretty(&data)?);
} else {
    // Human-readable format
    print_formatted(&data);
}
```

## Remote Server API Endpoints

The CLI communicates with the desktop app's remote server:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/chat` | Send chat message |
| GET | `/v1/mcp/servers` | List MCP servers |
| POST | `/v1/mcp/servers/:name/toggle` | Toggle server |
| GET | `/v1/profiles` | List profiles |
| POST | `/v1/profiles/current` | Switch profile |
| GET | `/v1/conversations` | List conversations |
| GET | `/v1/conversations/:id` | Get conversation |
| DELETE | `/v1/conversations/:id` | Delete conversation |
| GET | `/v1/settings` | Get settings |
| POST | `/v1/settings` | Update settings |
| POST | `/v1/emergency-stop` | Stop agent loop |
| POST | `/mcp/tools/list` | List available tools |
| POST | `/mcp/tools/call` | Execute a tool |

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_function_name() {
        // Arrange
        let input = "test";

        // Act
        let result = function_to_test(input);

        // Assert
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_async_function() {
        // Async test body
    }
}
```

## Dependencies

Key crates used:
- `clap` - CLI argument parsing with derive macros
- `tokio` - Async runtime
- `reqwest` - HTTP client
- `serde` / `serde_json` - Serialization
- `anyhow` - Error handling
- `colored` - Terminal colors
- `toml` - Config file parsing
- `dirs` - Platform-specific directories

## Configuration

Config file location: `~/.config/speakmcp/cli.toml`

```toml
server_url = "http://localhost:7777"
api_key = "your-key"
default_profile = "default"
colored_output = true
show_tool_calls = true
```
