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
use crate::types::ProfilesResponse;

/// List all profiles and their status
///
/// Calls GET /v1/profiles and displays the results.
pub async fn list_profiles(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: ProfilesResponse = client.get("v1/profiles").await?;

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

/// Placeholder for getting current profile
///
/// This function will be implemented to call GET /v1/profiles/current
pub async fn get_current_profile(_config: &Config, _json: bool) -> Result<()> {
    // TODO: Implement in task 2.2.1
    Ok(())
}

/// Placeholder for switching profiles
///
/// This function will be implemented to call POST /v1/profiles/current
pub async fn switch_profile(_config: &Config, _name: &str) -> Result<()> {
    // TODO: Implement in task 2.3.1
    Ok(())
}
