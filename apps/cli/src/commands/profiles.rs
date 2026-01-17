//! Profile management commands
//!
//! This module implements CLI commands for listing, viewing current, and switching
//! between profiles. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::{ProfileDetail, ProfilesResponse, SwitchProfileResponse};

/// List all profiles and their status
///
/// Calls GET /v1/profiles and displays the results.
pub async fn list_profiles(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: ProfilesResponse = client.get("profiles").await?;

    if json {
        print_json(&response.profiles)?;
    } else {
        let headers = &["NAME", "ID", "DEFAULT", "CURRENT"];
        let rows: Vec<TableRow> = response
            .profiles
            .iter()
            .map(|profile| {
                let is_default = if profile.is_default { "yes" } else { "no" };
                let is_current = response
                    .current_profile_id
                    .as_ref()
                    .is_some_and(|id| id == &profile.id);
                let current_marker = if is_current { "*" } else { "" };

                TableRow::new(vec![
                    profile.name.clone(),
                    profile.id.clone(),
                    is_default.to_string(),
                    current_marker.to_string(),
                ])
            })
            .collect();

        print_table(headers, &rows);
    }

    Ok(())
}

/// Get the currently active profile
///
/// Calls GET /v1/profiles/current and displays the profile details.
pub async fn get_current_profile(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let profile: ProfileDetail = client.get("profiles/current").await?;

    if json {
        print_json(&profile)?;
    } else {
        let headers = &["FIELD", "VALUE"];
        let rows = vec![
            TableRow::new(vec!["Name".to_string(), profile.name.clone()]),
            TableRow::new(vec!["ID".to_string(), profile.id.clone()]),
            TableRow::new(vec![
                "Default".to_string(),
                if profile.is_default { "yes" } else { "no" }.to_string(),
            ]),
            TableRow::new(vec![
                "Guidelines".to_string(),
                profile.guidelines.clone().unwrap_or_else(|| "-".to_string()),
            ]),
            TableRow::new(vec![
                "System Prompt".to_string(),
                profile
                    .system_prompt
                    .clone()
                    .map(|s| truncate_string(&s, 50))
                    .unwrap_or_else(|| "-".to_string()),
            ]),
        ];

        print_table(headers, &rows);
    }

    Ok(())
}

/// Truncate a string to a maximum length, adding ellipsis if needed
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

/// Request body for POST /v1/profiles/current
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SwitchProfileRequest {
    profile_id: String,
}

/// Switch to a different profile
///
/// Calls POST /v1/profiles/current with the profileId.
/// The profile_id can be either the profile ID or the profile name.
/// If a name is provided, we first look up the profile ID.
pub async fn switch_profile(config: &Config, profile_id: &str, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;

    // First, try to find the profile by name if it's not a valid ID
    let actual_profile_id = resolve_profile_id(&client, profile_id).await?;

    let request = SwitchProfileRequest {
        profile_id: actual_profile_id.clone(),
    };

    let response: SwitchProfileResponse = client.post("profiles/current", &request).await?;

    if json {
        print_json(&response)?;
    } else {
        println!("Switched to profile: {} ({})", response.profile.name, response.profile.id);
    }

    Ok(())
}

/// Resolve a profile name or ID to an actual profile ID
///
/// If the input looks like a profile ID, return it directly.
/// Otherwise, look up the profile by name.
async fn resolve_profile_id(client: &ApiClient, name_or_id: &str) -> Result<String> {
    // Fetch profiles list
    let response: ProfilesResponse = client.get("profiles").await?;

    // First check if it matches an ID exactly
    if response.profiles.iter().any(|p| p.id == name_or_id) {
        return Ok(name_or_id.to_string());
    }

    // Then check if it matches a name (case-insensitive)
    if let Some(profile) = response
        .profiles
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name_or_id))
    {
        return Ok(profile.id.clone());
    }

    Err(anyhow::anyhow!(
        "Profile '{}' not found. Use 'speakmcp profiles list' to see available profiles.",
        name_or_id
    ))
}
