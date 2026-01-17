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

/// Response wrapper for GET /v1/profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesResponse {
    pub profiles: Vec<Profile>,
    pub current_profile_id: Option<String>,
}

/// User profile from GET /v1/profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Profile ID (unique identifier)
    pub id: String,

    /// Profile name
    pub name: String,

    /// Whether this is the default profile
    pub is_default: bool,

    /// Creation timestamp
    #[serde(default)]
    pub created_at: Option<u64>,

    /// Last update timestamp
    #[serde(default)]
    pub updated_at: Option<u64>,
}

/// Detailed profile response from GET /v1/profiles/current
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDetail {
    /// Profile ID (unique identifier)
    pub id: String,

    /// Profile name
    pub name: String,

    /// Whether this is the default profile
    pub is_default: bool,

    /// Guidelines for the profile
    #[serde(default)]
    pub guidelines: Option<String>,

    /// System prompt for the profile
    #[serde(default)]
    pub system_prompt: Option<String>,

    /// Creation timestamp
    #[serde(default)]
    pub created_at: Option<u64>,

    /// Last update timestamp
    #[serde(default)]
    pub updated_at: Option<u64>,
}

/// Response from POST /v1/profiles/current
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchProfileResponse {
    pub success: bool,
    pub profile: Profile,
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
