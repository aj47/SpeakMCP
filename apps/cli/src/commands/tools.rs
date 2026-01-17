//! MCP tool management commands
//!
//! This module implements CLI commands for listing available MCP tools and
//! calling tools directly. These commands communicate with the desktop app's
//! remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;
use serde::Serialize;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::ToolsListResponse;

/// Empty request body for POST /mcp/tools/list
#[derive(Serialize)]
struct ListToolsRequest {}

/// List all available MCP tools
///
/// Calls POST /mcp/tools/list and displays the results.
pub async fn list_tools(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let request = ListToolsRequest {};
    let response: ToolsListResponse = client.post("mcp/tools/list", &request).await?;

    if json {
        print_json(&response.tools)?;
    } else {
        let headers = &["NAME", "DESCRIPTION"];
        let rows: Vec<TableRow> = response
            .tools
            .iter()
            .map(|tool| {
                // Truncate description to 60 chars for table display
                let desc = if tool.description.len() > 60 {
                    format!("{}...", &tool.description[..57])
                } else {
                    tool.description.clone()
                };

                TableRow::new(vec![tool.name.clone(), desc])
            })
            .collect();

        if rows.is_empty() {
            println!("No tools available");
        } else {
            print_table(headers, &rows);
        }
    }

    Ok(())
}

/// Call an MCP tool by name with optional arguments
///
/// Calls POST /mcp/tools/call with the tool name and arguments.
pub async fn call_tool(_config: &Config, _name: &str, _args: Option<&str>, _json: bool) -> Result<()> {
    // TODO: Implement in task 3.2.1
    Ok(())
}
