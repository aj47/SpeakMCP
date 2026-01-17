//! MCP tool management commands
//!
//! This module implements CLI commands for listing available MCP tools and
//! calling tools directly. These commands communicate with the desktop app's
//! remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;

/// List all available MCP tools
///
/// Calls POST /mcp/tools/list and displays the results.
pub async fn list_tools(_config: &Config, _json: bool) -> Result<()> {
    // TODO: Implement in task 3.1.5
    Ok(())
}

/// Call an MCP tool by name with optional arguments
///
/// Calls POST /mcp/tools/call with the tool name and arguments.
pub async fn call_tool(_config: &Config, _name: &str, _args: Option<&str>, _json: bool) -> Result<()> {
    // TODO: Implement in task 3.2.1
    Ok(())
}
