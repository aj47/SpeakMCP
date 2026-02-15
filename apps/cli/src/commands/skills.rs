//! Skills management commands
//!
//! This module implements CLI commands for listing skills.
//! Skills are custom automation workflows that enhance the LLM's capabilities.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};
use crate::types::SkillsResponse;

/// List all available skills
///
/// Calls GET /v1/skills and displays the results.
pub async fn list_skills(config: &Config, json: bool) -> Result<()> {
    let client = ApiClient::from_config(config)?;
    let response: SkillsResponse = client.get("skills").await?;

    if json {
        print_json(&response.skills)?;
    } else {
        if response.skills.is_empty() {
            println!("No skills found.");
            return Ok(());
        }

        let headers = &["NAME", "DESCRIPTION", "ENABLED", "SOURCE"];
        let rows: Vec<TableRow> = response
            .skills
            .iter()
            .map(|skill| {
                let description_preview = truncate_string(&skill.description, 50);
                let enabled_str = if skill.enabled { "Yes" } else { "No" };
                let source = skill.source.clone().unwrap_or_else(|| "local".to_string());

                TableRow::new(vec![
                    skill.name.clone(),
                    description_preview,
                    enabled_str.to_string(),
                    source,
                ])
            })
            .collect();

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
