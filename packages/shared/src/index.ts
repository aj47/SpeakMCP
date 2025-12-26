/**
 * @speakmcp/shared
 *
 * Shared design tokens, types, and utilities for SpeakMCP apps
 */

export * from './colors';
export * from './types';
export * from './tts-preprocessing';
export * from './chat-utils';
export * from './time-utils';
// Note: hooks are NOT exported from root entry to avoid React dependency for Node-only consumers
// Use `import { ... } from '@speakmcp/shared/hooks'` for React hooks

