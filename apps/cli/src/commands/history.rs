//! Conversation history management commands
//!
//! This module implements CLI commands for listing, viewing, deleting, exporting,
//! and continuing conversations. These commands communicate with the desktop app's remote server.

// Allow dead code - functions will be wired up in later phases
#![allow(dead_code)]

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;
use crate::output::{print_json, print_table, TableRow};

/// Placeholder - list_conversations will be implemented in task 4.1.5
pub async fn list_conversations(_config: &Config, _json: bool) -> Result<()> {
    todo!("list_conversations not yet implemented")
}

/// Placeholder - show_conversation will be implemented in task 4.2.1
pub async fn show_conversation(_config: &Config, _id: &str, _json: bool) -> Result<()> {
    todo!("show_conversation not yet implemented")
}

/// Placeholder - delete_conversation will be implemented in task 4.3.1
pub async fn delete_conversation(_config: &Config, _id: &str) -> Result<()> {
    todo!("delete_conversation not yet implemented")
}

/// Placeholder - export_conversation will be implemented in task 4.4.1
pub async fn export_conversation(
    _config: &Config,
    _id: &str,
    _output: Option<&str>,
    _json: bool,
) -> Result<()> {
    todo!("export_conversation not yet implemented")
}

/// Placeholder - continue_conversation will be implemented in task 4.5.1
pub async fn continue_conversation(_config: &Config, _id: &str) -> Result<()> {
    todo!("continue_conversation not yet implemented")
}
