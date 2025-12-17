//! Configuration management for SpeakMCP CLI
//!
//! Loads and saves configuration from ~/.config/speakmcp/cli.toml

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::path::PathBuf;

/// CLI configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Remote server URL (e.g., "http://localhost:3210/v1")
    #[serde(default = "default_server_url")]
    pub server_url: String,

    /// API key for authentication with the remote server
    #[serde(default)]
    pub api_key: String,

    /// Default conversation ID to continue (optional)
    #[serde(default)]
    pub default_conversation_id: Option<String>,

    /// Enable colored output
    #[serde(default = "default_true")]
    pub colored_output: bool,

    /// Show tool calls in output
    #[serde(default = "default_true")]
    pub show_tool_calls: bool,

    /// Maximum response tokens (0 = unlimited)
    #[serde(default)]
    pub max_tokens: u32,
}

fn default_server_url() -> String {
    "http://localhost:3210/v1".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: default_server_url(),
            api_key: String::new(),
            default_conversation_id: None,
            colored_output: true,
            show_tool_calls: true,
            max_tokens: 0,
        }
    }
}

impl Config {
    /// Get the config directory path
    pub fn config_dir() -> Option<PathBuf> {
        dirs::config_dir().map(|p| p.join("speakmcp"))
    }

    /// Get the config file path
    pub fn config_path() -> Option<PathBuf> {
        Self::config_dir().map(|p| p.join("cli.toml"))
    }

    /// Load configuration from disk
    pub fn load() -> Result<Self> {
        let path = Self::config_path().context("Could not determine config path")?;

        if !path.exists() {
            return Ok(Self::default());
        }

        let content = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;

        let config: Self = toml::from_str(&content)
            .with_context(|| format!("Failed to parse config file: {}", path.display()))?;

        Ok(config)
    }

    /// Save configuration to disk
    pub fn save(&self) -> Result<()> {
        let dir = Self::config_dir().context("Could not determine config directory")?;
        let path = Self::config_path().context("Could not determine config path")?;

        // Ensure config directory exists
        fs::create_dir_all(&dir)
            .with_context(|| format!("Failed to create config directory: {}", dir.display()))?;

        // Tighten directory permissions on Unix (0700 - owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir_perms = fs::Permissions::from_mode(0o700);
            fs::set_permissions(&dir, dir_perms).with_context(|| {
                format!(
                    "Failed to set permissions on config directory: {}",
                    dir.display()
                )
            })?;
        }

        let content = toml::to_string_pretty(self).context("Failed to serialize config")?;

        // Write file with restrictive permissions.
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;

            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&path)
                .and_then(|mut file| std::io::Write::write_all(&mut file, content.as_bytes()))
                .with_context(|| format!("Failed to write config file: {}", path.display()))?;
        }

        #[cfg(not(unix))]
        {
            fs::write(&path, &content)
                .with_context(|| format!("Failed to write config file: {}", path.display()))?;
        }

        // On non-Windows Unix we also set permissions to be sure (in case file existed)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&path, permissions).with_context(|| {
                format!(
                    "Failed to set permissions on config file: {}",
                    path.display()
                )
            })?;
        }

        Ok(())
    }

    /// Initialize a new config file with default values
    pub fn init() -> Result<PathBuf> {
        let config = Self::default();
        config.save()?;
        Self::config_path().context("Could not determine config path")
    }
}
