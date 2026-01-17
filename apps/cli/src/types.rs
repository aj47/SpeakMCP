//! Shared types for API responses
//!
//! This module contains shared structs used across command modules for
//! serializing/deserializing API responses from the SpeakMCP remote server.

// Allow unused imports - these will be used when types are added in later phases
#![allow(unused_imports)]

use serde::{Deserialize, Serialize};

// Types will be added as commands are implemented:
// - Profile (Phase 2)
// - Tool (Phase 3)
// - Conversation (Phase 4)
// - Settings (Phase 5)
// - Memory (Phase 10)
// - ModelPreset (Phase 11)
// - Skill (Phase 12)
// - HealthStatus (Phase 13)

/// Response wrapper for GET /v1/mcp/servers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServersResponse {
    pub servers: Vec<McpServer>,
}

/// MCP server status from GET /v1/mcp/servers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    /// Server name (unique identifier)
    pub name: String,

    /// Whether the server is currently connected
    pub connected: bool,

    /// Number of tools provided by this server
    pub tool_count: u32,

    /// Whether the server is enabled (runtime_enabled && !config_disabled)
    pub enabled: bool,

    /// Whether the server is enabled at runtime
    pub runtime_enabled: bool,

    /// Whether the server is disabled in config
    pub config_disabled: bool,

    /// Error message if connection failed
    #[serde(default)]
    pub error: Option<String>,
}
