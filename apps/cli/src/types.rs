//! Shared types for API responses
//!
//! This module contains shared structs used across command modules for
//! serializing/deserializing API responses from the SpeakMCP remote server.

// Allow unused imports - these will be used when types are added in later phases
#![allow(unused_imports)]
// Allow dead code - types are added incrementally as commands are implemented
#![allow(dead_code)]

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

    /// Whether this is the default profile (only present when true in API response)
    #[serde(default)]
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

    /// Whether this is the default profile (only present when true in API response)
    #[serde(default)]
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

/// Response wrapper for POST /mcp/tools/list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsListResponse {
    pub tools: Vec<Tool>,
}

/// MCP Tool from POST /mcp/tools/list
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// Tool name (unique identifier)
    pub name: String,

    /// Tool description
    pub description: String,

    /// JSON Schema for tool input parameters
    #[serde(default)]
    pub input_schema: Option<serde_json::Value>,
}

/// Response wrapper for POST /mcp/tools/call
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallResponse {
    /// Content returned by the tool
    pub content: Vec<ToolContent>,

    /// Whether the tool execution resulted in an error
    #[serde(default)]
    pub is_error: bool,
}

/// Content item from a tool call response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolContent {
    /// Content type (usually "text")
    #[serde(rename = "type")]
    pub content_type: String,

    /// The actual content text
    #[serde(default)]
    pub text: Option<String>,
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

/// Response wrapper for GET /v1/conversations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationsResponse {
    pub conversations: Vec<ConversationHistoryItem>,
}

/// Conversation summary from GET /v1/conversations (list endpoint)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationHistoryItem {
    /// Conversation ID (unique identifier)
    pub id: String,

    /// Conversation title
    pub title: String,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: u64,

    /// Last update timestamp (Unix milliseconds)
    pub updated_at: u64,

    /// Number of messages in the conversation
    pub message_count: u32,

    /// Last message content (truncated)
    #[serde(default)]
    pub last_message: Option<String>,

    /// Preview of the conversation
    #[serde(default)]
    pub preview: Option<String>,
}

/// Full conversation from GET /v1/conversations/:id
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    /// Conversation ID (unique identifier)
    pub id: String,

    /// Conversation title
    pub title: String,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: u64,

    /// Last update timestamp (Unix milliseconds)
    pub updated_at: u64,

    /// Messages in the conversation
    pub messages: Vec<ConversationMessage>,

    /// Optional metadata
    #[serde(default)]
    pub metadata: Option<ConversationMetadata>,
}

/// Message within a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    /// Message ID (unique within conversation)
    pub id: String,

    /// Role of the message sender
    pub role: String,

    /// Message content
    pub content: String,

    /// Timestamp (Unix milliseconds)
    pub timestamp: u64,

    /// Tool calls made by the assistant (if any)
    #[serde(default)]
    pub tool_calls: Option<Vec<ConversationToolCall>>,

    /// Tool results (if any)
    #[serde(default)]
    pub tool_results: Option<Vec<ConversationToolResult>>,
}

/// Tool call within a conversation message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationToolCall {
    /// Tool name
    pub name: String,

    /// Tool arguments as JSON value
    pub arguments: serde_json::Value,
}

/// Tool result within a conversation message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationToolResult {
    /// Whether the tool call was successful
    pub success: bool,

    /// Result content
    pub content: String,

    /// Error message (if failed)
    #[serde(default)]
    pub error: Option<String>,
}

/// Optional metadata for a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMetadata {
    /// Total tokens used in the conversation
    #[serde(default)]
    pub total_tokens: Option<u32>,

    /// Model used for the conversation
    #[serde(default)]
    pub model: Option<String>,

    /// Provider used for the conversation
    #[serde(default)]
    pub provider: Option<String>,

    /// Whether agent mode was used
    #[serde(default)]
    pub agent_mode: Option<bool>,
}

/// Application settings from GET /v1/settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// MCP tools provider ID (e.g., "openai", "groq", "gemini")
    #[serde(default)]
    pub mcp_tools_provider: Option<String>,

    /// MCP tools provider ID (alias for mcp_tools_provider)
    #[serde(default, rename = "mcpToolsProviderId")]
    pub mcp_tools_provider_id: Option<String>,

    /// OpenAI model for MCP tools
    #[serde(default)]
    pub mcp_tools_openai_model: Option<String>,

    /// Groq model for MCP tools
    #[serde(default)]
    pub mcp_tools_groq_model: Option<String>,

    /// Gemini model for MCP tools
    #[serde(default)]
    pub mcp_tools_gemini_model: Option<String>,

    /// Current model preset ID
    #[serde(default)]
    pub current_model_preset_id: Option<String>,

    /// Available model presets
    #[serde(default)]
    pub available_presets: Option<Vec<SettingsPreset>>,

    /// Whether to require approval before tool calls
    #[serde(default)]
    pub mcp_require_approval_before_tool_call: Option<bool>,

    /// Whether TTS is enabled
    #[serde(default)]
    pub tts_enabled: Option<bool>,

    /// Whether WhatsApp integration is enabled
    #[serde(default)]
    pub whatsapp_enabled: Option<bool>,

    /// Maximum MCP iterations in agent mode
    #[serde(default)]
    pub mcp_max_iterations: Option<u32>,

    /// Whether agent mode is enabled (derived for CLI display)
    #[serde(default)]
    pub agent_mode_enabled: Option<bool>,

    /// Whether auto submit is enabled
    #[serde(default)]
    pub auto_submit: Option<bool>,

    /// Whether auto listen is enabled
    #[serde(default)]
    pub auto_listen: Option<bool>,

    /// UI theme
    #[serde(default)]
    pub theme: Option<String>,
}

/// Model preset in settings response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPreset {
    /// Preset ID
    pub id: String,

    /// Preset name
    pub name: String,

    /// Whether this is a built-in preset
    #[serde(default)]
    pub is_built_in: Option<bool>,
}

/// Model preset from GET /v1/settings availablePresets
/// JSON fields: id, name, baseUrl, isBuiltIn
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreset {
    /// Preset ID (unique identifier)
    pub id: String,

    /// Preset name
    pub name: String,

    /// Base URL for the model API
    #[serde(default)]
    pub base_url: Option<String>,

    /// Whether this is a built-in preset (JSON: isBuiltIn)
    #[serde(default)]
    pub is_built_in: bool,
}

/// Response from GET /v1/settings for presets listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    /// Current model preset ID
    #[serde(default)]
    pub current_model_preset_id: Option<String>,

    /// Available model presets
    #[serde(default)]
    pub available_presets: Vec<ModelPreset>,

    /// MCP tools provider ID
    #[serde(default)]
    pub mcp_tools_provider_id: Option<String>,

    /// OpenAI model for MCP tools
    #[serde(default)]
    pub mcp_tools_openai_model: Option<String>,

    /// Groq model for MCP tools
    #[serde(default)]
    pub mcp_tools_groq_model: Option<String>,

    /// Gemini model for MCP tools
    #[serde(default)]
    pub mcp_tools_gemini_model: Option<String>,

    /// Whether transcript post-processing is enabled
    #[serde(default)]
    pub transcript_post_processing_enabled: Option<bool>,

    /// Whether to require approval before tool calls
    #[serde(default)]
    pub mcp_require_approval_before_tool_call: Option<bool>,

    /// Whether TTS is enabled
    #[serde(default)]
    pub tts_enabled: Option<bool>,

    /// Whether WhatsApp integration is enabled
    #[serde(default)]
    pub whatsapp_enabled: Option<bool>,

    /// Maximum MCP iterations in agent mode
    #[serde(default)]
    pub mcp_max_iterations: Option<u32>,
}

/// Response from PATCH /v1/settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdateResponse {
    /// Whether the update was successful
    pub success: bool,

    /// List of updated setting keys
    #[serde(default)]
    pub updated: Vec<String>,
}

/// Response wrapper for GET /v1/skills
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsResponse {
    pub skills: Vec<Skill>,
}

/// Agent skill from GET /v1/skills
/// Skills are instruction files that can be loaded dynamically to improve AI performance
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Skill ID (unique identifier)
    pub id: String,

    /// Skill name
    pub name: String,

    /// Skill description
    pub description: String,

    /// Markdown content with instructions
    pub instructions: String,

    /// Whether the skill is enabled
    pub enabled: bool,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: u64,

    /// Last update timestamp (Unix milliseconds)
    pub updated_at: u64,

    /// Source of the skill (local or imported)
    #[serde(default)]
    pub source: Option<String>,

    /// Path to the SKILL.md file if loaded from disk
    #[serde(default)]
    pub file_path: Option<String>,
}

/// Response wrapper for GET /v1/memories
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoriesResponse {
    pub memories: Vec<Memory>,
}

/// Memory item from GET /v1/memories
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    /// Memory ID (unique identifier)
    pub id: String,

    /// Memory content text
    pub content: String,

    /// Importance level (0-10)
    pub importance: u32,

    /// Tags associated with the memory
    #[serde(default)]
    pub tags: Vec<String>,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: u64,

    /// Profile ID this memory belongs to
    #[serde(default)]
    pub profile_id: Option<String>,
}

/// Health status from GET /v1/health
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    /// Status string (e.g., "ok", "degraded", "error")
    pub status: String,

    /// Application version
    #[serde(default)]
    pub version: Option<String>,

    /// Uptime in seconds
    #[serde(default)]
    pub uptime: Option<u64>,
}
