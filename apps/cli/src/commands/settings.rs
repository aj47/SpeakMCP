//! Settings management commands
//!
//! This module implements CLI commands for viewing and updating
//! application settings. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::Settings;

/// Show current application settings
///
/// Calls GET /v1/settings and displays the results.
pub async fn show_settings(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let settings: Settings = client.get("settings").await?;

    if json {
        print_json(&settings)?;
    } else {
        let headers = &["SETTING", "VALUE"];
        let rows = vec![
            TableRow::new(vec![
                "MCP Tools Provider".to_string(),
                settings.mcp_tools_provider.clone().unwrap_or_else(|| "-".to_string()),
            ]),
            TableRow::new(vec![
                "Agent Mode Enabled".to_string(),
                settings.agent_mode_enabled.map_or("-".to_string(), |v| if v { "yes" } else { "no" }.to_string()),
            ]),
            TableRow::new(vec![
                "Auto Submit".to_string(),
                settings.auto_submit.map_or("-".to_string(), |v| if v { "yes" } else { "no" }.to_string()),
            ]),
            TableRow::new(vec![
                "Auto Listen".to_string(),
                settings.auto_listen.map_or("-".to_string(), |v| if v { "yes" } else { "no" }.to_string()),
            ]),
            TableRow::new(vec![
                "Theme".to_string(),
                settings.theme.clone().unwrap_or_else(|| "-".to_string()),
            ]),
        ];

        print_table(headers, &rows);
    }

    Ok(())
}

/// Request body for POST /v1/settings
#[derive(serde::Serialize)]
struct UpdateSettingRequest {
    key: String,
    value: serde_json::Value,
}

/// Update a single setting value
///
/// Calls POST /v1/settings to update a key-value pair.
/// Values are automatically converted to the appropriate type:
/// - "true"/"false" -> boolean
/// - numeric strings -> numbers
/// - other strings -> string
pub async fn update_setting(config: &Config, key: &str, value: &str) -> Result<()> {
    let client = ApiClient::from_config(config)?;

    // Parse the value to appropriate JSON type
    let json_value = parse_value(value);

    let request = UpdateSettingRequest {
        key: key.to_string(),
        value: json_value,
    };

    // POST to update the setting
    let _response: serde_json::Value = client.post("settings", &request).await?;

    println!("Setting '{}' updated to '{}'", key, value);

    Ok(())
}

/// Parse a string value into an appropriate JSON value
fn parse_value(value: &str) -> serde_json::Value {
    // Check for boolean
    if value.eq_ignore_ascii_case("true") {
        return serde_json::Value::Bool(true);
    }
    if value.eq_ignore_ascii_case("false") {
        return serde_json::Value::Bool(false);
    }

    // Check for integer
    if let Ok(n) = value.parse::<i64>() {
        return serde_json::Value::Number(n.into());
    }

    // Check for float
    if let Ok(n) = value.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(n) {
            return serde_json::Value::Number(num);
        }
    }

    // Default to string
    serde_json::Value::String(value.to_string())
}
