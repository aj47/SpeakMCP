//! Shared types for API responses
//!
//! This module contains shared structs used across command modules for
//! serializing/deserializing API responses from the SpeakMCP remote server.

// Allow unused imports - these will be used when types are added in later phases
#![allow(unused_imports)]

use serde::{Deserialize, Serialize};

// Types will be added as commands are implemented:
// - McpServer (Phase 1)
// - Profile (Phase 2)
// - Tool (Phase 3)
// - Conversation (Phase 4)
// - Settings (Phase 5)
// - Memory (Phase 10)
// - ModelPreset (Phase 11)
// - Skill (Phase 12)
// - HealthStatus (Phase 13)
