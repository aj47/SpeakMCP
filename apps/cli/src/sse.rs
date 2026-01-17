//! SSE (Server-Sent Events) handling for streaming API responses
//!
//! This module provides types and utilities for parsing SSE events
//! from the SpeakMCP remote server's streaming chat endpoint.

use serde::{Deserialize, Serialize};

use crate::api::ConversationMessage;

/// An SSE event received from the server
#[derive(Debug, Clone)]
pub enum SseEvent {
    /// Progress update during agent execution
    Progress(AgentProgressUpdate),
    /// Final response with complete data
    Done(DoneEvent),
    /// Error occurred during processing
    Error(ErrorEvent),
    /// Unknown event type (stores raw data for debugging)
    #[allow(dead_code)]
    Unknown(String),
}

/// Progress update from the agent during execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressUpdate {
    /// Session ID for this agent run
    pub session_id: String,
    /// Conversation ID if continuing a conversation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// Title of the conversation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_title: Option<String>,
    /// Current iteration number
    pub current_iteration: i32,
    /// Maximum iterations allowed
    pub max_iterations: i32,
    /// Steps completed so far
    pub steps: Vec<AgentProgressStep>,
    /// Whether the agent has completed
    pub is_complete: bool,
    /// Whether the agent is snoozed (waiting for approval, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_snoozed: Option<bool>,
    /// Final content if complete
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_content: Option<String>,
    /// Streaming content during LLM generation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming_content: Option<StreamingContent>,
    /// Conversation history
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_history: Option<Vec<ConversationMessage>>,
}

/// Streaming content during LLM response generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingContent {
    /// The accumulated text so far
    pub text: String,
    /// Whether streaming is still in progress
    pub is_streaming: bool,
}

/// A step in the agent's progress
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressStep {
    /// Unique identifier for this step
    pub id: String,
    /// Type of step (thinking, tool_call, tool_result, etc.)
    #[serde(rename = "type")]
    pub step_type: String,
    /// Human-readable title
    pub title: String,
    /// Status of this step
    pub status: String,
    /// Tool call details if this is a tool call step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<ToolCallInfo>,
    /// Tool result details if this is a tool result step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<ToolResultInfo>,
    /// LLM content for thinking steps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_content: Option<String>,
}

/// Tool call information in a progress step
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallInfo {
    /// Name of the tool
    pub name: String,
    /// Arguments passed to the tool
    #[serde(default)]
    pub arguments: serde_json::Value,
    /// Server that provides this tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
}

/// Tool result information in a progress step
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultInfo {
    /// Whether the tool execution succeeded
    pub success: bool,
    /// Result content
    pub content: String,
    /// Error message if failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Final "done" event with complete response data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoneEvent {
    /// The final response content
    pub content: String,
    /// Conversation ID for follow-up messages
    pub conversation_id: Option<String>,
    /// Full conversation history
    pub conversation_history: Option<Vec<ConversationMessage>>,
    /// Model used for the response
    pub model: Option<String>,
}

/// Error event from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    /// Error message
    pub message: String,
}

/// Raw SSE message envelope from the server
#[derive(Debug, Clone, Deserialize)]
struct SseEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    data: serde_json::Value,
}

/// Parse an SSE data line into an event
///
/// SSE format is: `data: <json>\n\n`
/// The JSON structure is: `{ "type": "progress|done|error", "data": {...} }`
pub fn parse_sse_event(data: &str) -> Option<SseEvent> {
    // Skip empty lines and [DONE] markers
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }

    // Parse the envelope
    let envelope: SseEnvelope = match serde_json::from_str(data) {
        Ok(e) => e,
        Err(_) => return Some(SseEvent::Unknown(data.to_string())),
    };

    // Parse based on event type
    match envelope.event_type.as_str() {
        "progress" => {
            match serde_json::from_value::<AgentProgressUpdate>(envelope.data) {
                Ok(update) => Some(SseEvent::Progress(update)),
                Err(_) => Some(SseEvent::Unknown(data.to_string())),
            }
        }
        "done" => {
            match serde_json::from_value::<DoneEvent>(envelope.data) {
                Ok(done) => Some(SseEvent::Done(done)),
                Err(_) => Some(SseEvent::Unknown(data.to_string())),
            }
        }
        "error" => {
            match serde_json::from_value::<ErrorEvent>(envelope.data) {
                Ok(err) => Some(SseEvent::Error(err)),
                Err(_) => Some(SseEvent::Unknown(data.to_string())),
            }
        }
        _ => Some(SseEvent::Unknown(data.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_progress_event() {
        let data = r#"{"type":"progress","data":{"sessionId":"abc123","currentIteration":1,"maxIteration":10,"steps":[],"isComplete":false}}"#;
        let event = parse_sse_event(data);
        assert!(matches!(event, Some(SseEvent::Progress(_))));
    }

    #[test]
    fn test_parse_done_event() {
        let data = r#"{"type":"done","data":{"content":"Hello!","conversation_id":"conv123"}}"#;
        let event = parse_sse_event(data);
        assert!(matches!(event, Some(SseEvent::Done(_))));
        if let Some(SseEvent::Done(done)) = event {
            assert_eq!(done.content, "Hello!");
            assert_eq!(done.conversation_id, Some("conv123".to_string()));
        }
    }

    #[test]
    fn test_parse_error_event() {
        let data = r#"{"type":"error","data":{"message":"Something went wrong"}}"#;
        let event = parse_sse_event(data);
        assert!(matches!(event, Some(SseEvent::Error(_))));
        if let Some(SseEvent::Error(err)) = event {
            assert_eq!(err.message, "Something went wrong");
        }
    }

    #[test]
    fn test_parse_empty_line() {
        assert!(parse_sse_event("").is_none());
        assert!(parse_sse_event("   ").is_none());
    }

    #[test]
    fn test_parse_done_marker() {
        assert!(parse_sse_event("[DONE]").is_none());
    }

    #[test]
    fn test_parse_unknown_type() {
        let data = r#"{"type":"unknown_type","data":{}}"#;
        let event = parse_sse_event(data);
        assert!(matches!(event, Some(SseEvent::Unknown(_))));
    }

    #[test]
    fn test_parse_invalid_json() {
        let data = "not valid json";
        let event = parse_sse_event(data);
        assert!(matches!(event, Some(SseEvent::Unknown(_))));
    }
}
