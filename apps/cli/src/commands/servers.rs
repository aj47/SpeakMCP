//! MCP server management commands
//!
//! This module implements CLI commands for listing, enabling, and disabling
//! MCP servers. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;

/// List all MCP servers and their status
///
/// Calls GET /v1/mcp/servers and displays the results.
pub async fn list_servers(_config: &Config, _json: bool) -> Result<()> {
    // TODO: Implement in task 1.1.5
    // - Create ApiClient from config
    // - Call GET /v1/mcp/servers
    // - Display results in table or JSON format
    Ok(())
}

/// Toggle an MCP server's enabled state
///
/// Calls POST /v1/mcp/servers/:name/toggle with the desired state.
pub async fn toggle_server(_config: &Config, _name: &str, _enabled: bool) -> Result<()> {
    // TODO: Implement in task 1.2.1
    // - Create ApiClient from config
    // - Call POST /v1/mcp/servers/:name/toggle
    // - Display success/failure message
    Ok(())
}
