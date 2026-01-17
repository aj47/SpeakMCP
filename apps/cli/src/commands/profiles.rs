//! Profile management commands
//!
//! This module implements CLI commands for listing, viewing current, and switching
//! between profiles. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;

/// Placeholder for profile listing
///
/// This function will be implemented to call GET /v1/profiles
pub async fn list_profiles(_config: &Config, _json: bool) -> Result<()> {
    // TODO: Implement in task 2.1.5
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
