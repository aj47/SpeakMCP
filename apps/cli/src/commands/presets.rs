//! Model preset management commands
//!
//! This module implements CLI commands for listing model presets and switching
//! between them. Model presets define LLM provider configurations (OpenAI, Groq, etc.).

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::{SettingsResponse, SettingsUpdateResponse};

/// List all available model presets
///
/// Calls GET /v1/settings and displays the available presets.
pub async fn list_presets(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: SettingsResponse = client.get("settings").await?;

    if json {
        print_json(&response.available_presets)?;
    } else {
        let headers = &["NAME", "ID", "BASE URL", "BUILT-IN", "CURRENT"];
        let rows: Vec<TableRow> = response
            .available_presets
            .iter()
            .map(|preset| {
                let is_builtin = if preset.is_built_in { "yes" } else { "no" };
                let is_current = response
                    .current_model_preset_id
                    .as_ref()
                    .is_some_and(|id| id == &preset.id);
                let current_marker = if is_current { "*" } else { "" };

                TableRow::new(vec![
                    preset.name.clone(),
                    preset.id.clone(),
                    preset.base_url.clone().unwrap_or_else(|| "-".to_string()),
                    is_builtin.to_string(),
                    current_marker.to_string(),
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

    Ok(())
}

/// Request body for PATCH /v1/settings to switch preset
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SwitchPresetRequest {
    current_model_preset_id: String,
}

/// Switch to a different model preset
///
/// Calls PATCH /v1/settings with the currentModelPresetId.
/// The preset_id can be either the preset ID or the preset name.
/// If a name is provided, we first look up the preset ID.
pub async fn switch_preset(config: &Config, preset_id: &str, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;

    // First, try to find the preset by name if it's not a valid ID
    let actual_preset_id = resolve_preset_id(&client, preset_id).await?;

    let request = SwitchPresetRequest {
        current_model_preset_id: actual_preset_id.clone(),
    };

    let response: SettingsUpdateResponse = client.patch("settings", &request).await?;

    if json {
        print_json(&response)?;
    } else if response.success {
        // Fetch the preset name for display
        let settings: SettingsResponse = client.get("v1/settings").await?;
        let preset_name = settings
            .available_presets
            .iter()
            .find(|p| p.id == actual_preset_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| actual_preset_id.clone());

        println!("Switched to model preset: {} ({})", preset_name, actual_preset_id);
    } else {
        println!("Failed to switch preset");
    }

    Ok(())
}

/// Resolve a preset name or ID to an actual preset ID
///
/// If the input looks like a preset ID, return it directly.
/// Otherwise, look up the preset by name.
async fn resolve_preset_id(client: &ApiClient, name_or_id: &str) -> Result<String> {
    // Fetch settings to get presets list
    let response: SettingsResponse = client.get("settings").await?;

    // First check if it matches an ID exactly
    if response.available_presets.iter().any(|p| p.id == name_or_id) {
        return Ok(name_or_id.to_string());
    }

    // Then check if it matches a name (case-insensitive)
    if let Some(preset) = response
        .available_presets
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name_or_id))
    {
        return Ok(preset.id.clone());
    }

    Err(anyhow::anyhow!(
        "Preset '{}' not found. Use 'speakmcp presets list' to see available presets.",
        name_or_id
    ))
}
