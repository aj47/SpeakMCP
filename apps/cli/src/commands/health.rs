//! Health and diagnostics commands
//!
//! This module implements CLI commands for checking the health status of the
//! desktop app and retrieving recent error logs.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::HealthStatus;

/// Check the health status of the desktop app
///
/// Calls GET /v1/health and displays diagnostic information.
pub async fn check_health(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: HealthStatus = client.get("health").await?;

    if json {
        print_json(&response)?;
    } else {
        println!("Status: {}", response.status);
        println!("Version: {}", response.version.as_deref().unwrap_or("unknown"));
        if let Some(uptime) = response.uptime {
            println!("Uptime: {}s", uptime);
        }
    }

    Ok(())
}

/// Response from GET /v1/errors
#[derive(serde::Deserialize, serde::Serialize)]
struct ErrorsResponse {
    errors: Vec<ErrorEntry>,
}

/// A single error entry from the error log
#[derive(serde::Deserialize, serde::Serialize)]
struct ErrorEntry {
    timestamp: String,
    message: String,
    #[serde(default)]
    context: Option<String>,
}

/// Get recent errors from the desktop app
///
/// Calls GET /v1/errors and displays the error log.
pub async fn get_errors(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: ErrorsResponse = client.get("errors").await?;

    if json {
        print_json(&response.errors)?;
    } else if response.errors.is_empty() {
        println!("No recent errors");
    } else {
        let headers = &["TIMESTAMP", "MESSAGE", "CONTEXT"];
        let rows: Vec<TableRow> = response
            .errors
            .iter()
            .map(|err| {
                TableRow::new(vec![
                    err.timestamp.clone(),
                    err.message.clone(),
                    err.context.as_deref().unwrap_or("-").to_string(),
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

    Ok(())
}
