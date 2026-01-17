//! API client for communicating with SpeakMCP remote server
//!
//! This module implements the HTTP client that talks to the SpeakMCP
//! desktop app's remote server at /v1/chat/completions

// Allow dead code - ApiError and get/post methods will be used in later phases
#![allow(dead_code)]

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use reqwest_eventsource::{Event, EventSource};
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::sse::{parse_sse_event, SseEvent};

/// Typed API errors for better error handling
#[derive(Debug)]
pub enum ApiError {
    /// 401 Unauthorized - invalid or missing API key
    Unauthorized(String),
    /// 404 Not Found - resource does not exist
    NotFound(String),
    /// 500 Internal Server Error
    InternalServerError(String),
    /// Network error - connection failed, timeout, etc.
    NetworkError(String),
    /// Other HTTP errors (with status code and message)
    HttpError { status: u16, message: String },
    /// Failed to parse response
    ParseError(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Unauthorized(msg) => write!(f, "Unauthorized (401): {}", msg),
            ApiError::NotFound(msg) => write!(f, "Not Found (404): {}", msg),
            ApiError::InternalServerError(msg) => write!(f, "Internal Server Error (500): {}", msg),
            ApiError::NetworkError(msg) => write!(f, "Network Error: {}", msg),
            ApiError::HttpError { status, message } => write!(f, "HTTP Error ({}): {}", status, message),
            ApiError::ParseError(msg) => write!(f, "Parse Error: {}", msg),
        }
    }
}

impl std::error::Error for ApiError {}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
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

    /// Perform a generic POST request with a JSON body and deserialize the response
    pub async fn post<T, R>(&self, path: &str, body: &T) -> Result<R>
    where
        T: Serialize,
        R: serde::de::DeserializeOwned,
    {
        let url = self.endpoint(path);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .with_context(|| format!("Failed to connect to {}", url))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, body));
        }

        response
            .json::<R>()
            .await
            .context("Failed to parse API response")
    }

    /// Perform a DELETE request (returns no body)
    pub async fn delete(&self, path: &str) -> Result<()> {
        let url = self.endpoint(path);

        let response = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .with_context(|| format!("Failed to connect to {}", url))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, body));
        }

        Ok(())
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
            stream: None,
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

    /// Send a chat message with SSE streaming and call the callback for each event
    ///
    /// This method connects to the chat/completions endpoint with `stream: true`
    /// and processes SSE events as they arrive, calling the provided callback
    /// for each event.
    ///
    /// Returns the final ChatResponse once the stream completes.
    pub async fn chat_streaming<F>(
        &self,
        message: &str,
        conversation_id: Option<&str>,
        mut on_event: F,
    ) -> Result<ChatResponse>
    where
        F: FnMut(SseEvent),
    {
        let url = self.endpoint("chat/completions");

        let request = ChatRequest {
            model: "gpt-4o".to_string(),
            messages: vec![RequestMessage {
                role: "user".to_string(),
                content: message.to_string(),
            }],
            conversation_id: conversation_id.map(|s| s.to_string()),
            stream: Some(true),
        };

        // Build the request with SSE headers
        let request_builder = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .json(&request);

        // Create EventSource from the request builder
        let mut es = EventSource::new(request_builder)
            .context("Failed to create SSE connection")?;

        let mut final_response: Option<ChatResponse> = None;

        // Process SSE events
        while let Some(event) = es.next().await {
            match event {
                Ok(Event::Open) => {
                    // Connection opened, nothing to do
                }
                Ok(Event::Message(message)) => {
                    // Parse the SSE data
                    if let Some(sse_event) = parse_sse_event(&message.data) {
                        // Check if this is a done or error event before calling callback
                        let is_done = matches!(&sse_event, SseEvent::Done(_));
                        let error_message = match &sse_event {
                            SseEvent::Error(err) => Some(err.message.clone()),
                            _ => None,
                        };

                        // Extract final response data if this is a done event
                        if let SseEvent::Done(done) = &sse_event {
                            final_response = Some(ChatResponse {
                                content: done.content.clone(),
                                conversation_id: done.conversation_id.clone(),
                                conversation_history: done.conversation_history.clone(),
                                queued: None,
                            });
                        }

                        // Call the callback (moves sse_event)
                        on_event(sse_event);

                        // Handle stream termination
                        if is_done {
                            es.close();
                            break;
                        }
                        if let Some(err_msg) = error_message {
                            es.close();
                            return Err(anyhow!("Server error: {}", err_msg));
                        }
                    }
                }
                Err(err) => {
                    es.close();
                    return Err(anyhow!("SSE stream error: {}", err));
                }
            }
        }

        final_response.ok_or_else(|| anyhow!("Stream ended without receiving a done event"))
    }
}
