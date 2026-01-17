//! API client for communicating with SpeakMCP remote server
//!
//! This module implements the HTTP client that talks to the SpeakMCP
//! desktop app's remote server at /v1/chat/completions

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::Config;

/// Tool call information from the API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// Tool result information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A message in the conversation history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "toolCalls")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "toolResults")]
    pub tool_results: Option<Vec<ToolResult>>,
}

/// Chat completion request body (OpenAI-compatible format)
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<RequestMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct RequestMessage {
    role: String,
    content: String,
}

/// OpenAI-style choice in the response
#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: String,
}

/// Chat completion response from the remote server
/// Matches OpenAI format with additional conversation fields
#[derive(Debug, Deserialize)]
struct RawChatResponse {
    choices: Vec<Choice>,
    /// Conversation ID for continuing the conversation (snake_case from server)
    conversation_id: Option<String>,
    /// Full conversation history with tool calls (snake_case from server)
    conversation_history: Option<Vec<ConversationMessage>>,
}

/// Processed chat response for use in the CLI
#[derive(Debug)]
pub struct ChatResponse {
    /// The assistant's response content
    pub content: String,
    /// Conversation ID for continuing the conversation
    pub conversation_id: Option<String>,
    /// Full conversation history with tool calls
    pub conversation_history: Option<Vec<ConversationMessage>>,
    /// Whether the message was queued
    pub queued: Option<bool>,
}

/// SpeakMCP API client
pub struct ApiClient {
    client: reqwest::Client,
    server_url: String,
    api_key: String,
}

impl ApiClient {
    /// Create a new API client from config
    pub fn from_config(config: &Config) -> Result<Self> {
        if config.api_key.is_empty() {
            return Err(anyhow!(
                "API key not configured. Run 'speakmcp config --api-key <KEY>' to set it."
            ));
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            server_url: config.server_url.clone(),
            api_key: config.api_key.clone(),
        })
    }

    fn endpoint(&self, path: &str) -> String {
        let base = self.server_url.trim_end_matches('/');
        let suffix = path.trim_start_matches('/');
        format!("{}/{}", base, suffix)
    }

    /// Perform a generic GET request and deserialize the response
    pub async fn get<T>(&self, path: &str) -> Result<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let url = self.endpoint(path);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .with_context(|| format!("Failed to connect to {}", url))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, body));
        }

        response
            .json::<T>()
            .await
            .context("Failed to parse API response")
    }

    /// Send a chat message and get a response
    pub async fn chat(&self, message: &str, conversation_id: Option<&str>) -> Result<ChatResponse> {
        let url = self.endpoint("chat/completions");

        let request = ChatRequest {
            model: "gpt-4o".to_string(), // Model is configured on server side
            messages: vec![RequestMessage {
                role: "user".to_string(),
                content: message.to_string(),
            }],
            conversation_id: conversation_id.map(|s| s.to_string()),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .with_context(|| format!("Failed to connect to {}", url))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, body));
        }

        let raw_response = response
            .json::<RawChatResponse>()
            .await
            .context("Failed to parse API response")?;

        // Extract content from OpenAI-style choices array
        let content = raw_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| anyhow!("API response missing choices"))?;

        Ok(ChatResponse {
            content,
            conversation_id: raw_response.conversation_id,
            conversation_history: raw_response.conversation_history,
            queued: None, // Not currently used by server
        })
    }
}
