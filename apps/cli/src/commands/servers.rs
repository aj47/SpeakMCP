//! MCP server management commands
//!
//! This module implements CLI commands for listing, enabling, and disabling
//! MCP servers. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::McpServersResponse;

/// List all MCP servers and their status
///
/// Calls GET /v1/mcp/servers and displays the results.
pub async fn list_servers(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: McpServersResponse = client.get("v1/mcp/servers").await?;

    if json {
        print_json(&response.servers)?;
    } else {
        let headers = &["NAME", "STATUS", "TOOLS", "ENABLED", "ERROR"];
        let rows: Vec<TableRow> = response
            .servers
            .iter()
            .map(|server| {
                let status = if server.connected {
                    "connected"
                } else {
                    "disconnected"
                };
                let enabled = if server.enabled { "yes" } else { "no" };
                let error = server.error.as_deref().unwrap_or("-");

                TableRow::new(vec![
                    server.name.clone(),
                    status.to_string(),
                    server.tool_count.to_string(),
                    enabled.to_string(),
                    error.to_string(),
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

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
