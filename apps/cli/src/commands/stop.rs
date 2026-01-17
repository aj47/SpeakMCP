//! Emergency stop command
//!
//! This module implements the emergency stop command that halts
//! any running agent loops on the desktop app.

use anyhow::Result;

use crate::api::ApiClient;
use crate::config::Config;

/// Request body for POST /v1/emergency-stop
/// The endpoint may not require a body, but we provide an empty struct for consistency
#[derive(serde::Serialize)]
struct EmptyRequest {}

/// Response from POST /v1/emergency-stop
#[derive(serde::Deserialize)]
struct StopResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    message: Option<String>,
}

/// Emergency stop - halt any running agent loops
///
/// Calls POST /v1/emergency-stop to immediately stop any
/// in-progress agent operations on the desktop app.
pub async fn emergency_stop(config: &Config) -> Result<()> {
    let client = ApiClient::from_config(config)?;

    let request = EmptyRequest {};
    let response: StopResponse = client.post("emergency-stop", &request).await?;

    if response.success {
        println!("Emergency stop executed successfully");
    } else {
        let msg = response.message.unwrap_or_else(|| "No message".to_string());
        println!("Emergency stop sent: {}", msg);
    }

    Ok(())
}
