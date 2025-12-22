/**
 * PMPM - SpeakMCP Package Manager
 * 
 * Cross-platform utilities for managing Rust binary and development workflow.
 */

// Platform detection
export { detectPlatform, getPlatformDescription } from './platform.js';
export type { Platform, Arch, PlatformInfo } from './platform.js';

// Path utilities
export { findProjectRoot, getProjectPaths, isValidProject } from './paths.js';
export type { ProjectPaths } from './paths.js';

// Rust binary management
export {
  isCargoInstalled,
  getRustStatus,
  buildRustBinary,
  ensureRustBinary,
} from './rust.js';
export type { RustStatus } from './rust.js';

// Logger
export { logger } from './logger.js';

