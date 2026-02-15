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

/// Desktop app config JSON structure (subset of fields we care about)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    remote_server_api_key: Option<String>,
    remote_server_port: Option<u16>,
}

/// Get the desktop app's config.json path based on platform
///
/// - macOS: ~/Library/Application Support/app.speakmcp/config.json
/// - Windows: %APPDATA%/app.speakmcp/config.json
/// - Linux: ~/.config/app.speakmcp/config.json
fn get_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| {
            h.join("Library")
                .join("Application Support")
                .join("app.speakmcp")
                .join("config.json")
        })
    }

    #[cfg(target_os = "windows")]
    {
        dirs::config_dir().map(|c| c.join("app.speakmcp").join("config.json"))
    }

    #[cfg(target_os = "linux")]
    {
        dirs::config_dir().map(|c| c.join("app.speakmcp").join("config.json"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

/// Read the desktop app's config.json and extract remote server settings
pub fn read_desktop_config() -> Result<(String, u16)> {
    let path = get_desktop_config_path().context(
        "Could not determine desktop app config path for this platform",
    )?;

    if !path.exists() {
        anyhow::bail!(
            "Desktop app config not found at: {}\nMake sure the SpeakMCP desktop app has been run at least once.",
            path.display()
        );
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read desktop config file: {}", path.display()))?;

    let desktop_config: DesktopConfig = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse desktop config file: {}", path.display()))?;

    let api_key = desktop_config
        .remote_server_api_key
        .filter(|k| !k.is_empty())
        .context(
            "No remoteServerApiKey found in desktop config.\n\
             Enable the Remote Server in the desktop app settings first.",
        )?;

    let port = desktop_config.remote_server_port.unwrap_or(3210);

    Ok((api_key, port))
}

/// Import configuration from the SpeakMCP desktop app
///
/// This reads the Electron app's config.json and extracts:
/// - remoteServerApiKey -> api_key
/// - remoteServerPort -> used in server_url
pub fn import_from_desktop() -> Result<()> {
    use colored::Colorize;

    // Read the desktop config
    let (api_key, port) = read_desktop_config()?;

    // Load existing CLI config or create default
    let mut config = Config::load().unwrap_or_default();

    // Update with desktop values
    config.api_key = api_key;
    config.server_url = format!("http://localhost:{}/v1", port);

    // Save the updated config
    config.save()?;

    println!("{}", "Successfully imported config from desktop app!".green());
    println!("  Server URL: {}", config.server_url.cyan());
    println!(
        "  API Key: {}...",
        &config.api_key[..8.min(config.api_key.len())].dimmed()
    );

    if let Some(path) = Config::config_path() {
        println!();
        println!("{} {}", "Config saved to:".dimmed(), path.display());
    }

    Ok(())
}
