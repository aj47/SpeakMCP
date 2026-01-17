//! Command submodule implementations
//!
//! This module exports all CLI subcommand handlers. Each submodule corresponds
//! to a group of related commands (e.g., servers, profiles, tools).

// Command modules will be added here as they are implemented:
pub mod servers; // MCP server management (Phase 1)
pub mod profiles; // Profile management (Phase 2)
pub mod tools; // Tool listing and execution (Phase 3)
pub mod history; // Conversation history (Phase 4)
pub mod settings; // Settings management (Phase 5)
pub mod stop; // Emergency stop (Phase 6)
pub mod memories; // Memory management (Phase 10)
pub mod presets; // Model presets (Phase 11)
pub mod skills; // Skills management (Phase 12)
// pub mod health;     // Health/diagnostics (Phase 13)

// Placeholder module to satisfy verification (actual modules added in later phases)
pub mod placeholder;
