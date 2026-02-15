//! MCP tool management commands
//!
//! This module implements CLI commands for listing available MCP tools and
//! calling tools directly. These commands communicate with the desktop app's
//! remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::{Context, Result};
use serde::Serialize;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::{ToolCallResponse, ToolsListResponse};

/// Empty request body for POST /mcp/tools/list
#[derive(Serialize)]
struct ListToolsRequest {}

/// List all available MCP tools
///
/// Calls POST /mcp/tools/list and displays the results.
/// Note: /mcp/tools/list endpoint doesn't have /v1 prefix, so we use post_base.
pub async fn list_tools(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let request = ListToolsRequest {};
    let response: ToolsListResponse = client.post_base("mcp/tools/list", &request).await?;

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

/// Request body for POST /mcp/tools/call
#[derive(Serialize)]
struct CallToolRequest {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    arguments: Option<serde_json::Value>,
}

/// Call an MCP tool by name with optional arguments
///
/// Calls POST /mcp/tools/call with the tool name and arguments.
/// Arguments should be a JSON string that will be parsed into a JSON object.
pub async fn call_tool(config: &Config, name: &str, args: Option<&str>, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;

    // Parse arguments if provided
    let arguments: Option<serde_json::Value> = match args {
        Some(args_str) => {
            let parsed: serde_json::Value = serde_json::from_str(args_str)
                .with_context(|| format!("Invalid JSON arguments: {}", args_str))?;
            Some(parsed)
        }
        None => None,
    };

    let request = CallToolRequest {
        name: name.to_string(),
        arguments,
    };

    // Note: /mcp/tools/call endpoint doesn't have /v1 prefix, so we use post_base.
    let response: ToolCallResponse = client.post_base("mcp/tools/call", &request).await?;

    if json {
        print_json(&response)?;
    } else {
        // Print tool execution result
        if response.is_error {
            eprintln!("Tool execution failed:");
        }

        for content in &response.content {
            if let Some(text) = &content.text {
                println!("{}", text);
            }
        }
    }

    Ok(())
}
