/**
 * Langfuse Loader
 *
 * Handles optional langfuse dependency loading in a single place.
 * The require happens once at module load time, keeping the rest
 * of the codebase clean from dynamic import logic.
 */

// Attempt to load langfuse - it's an optional dependency
let langfuseModule: typeof import("langfuse") | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  langfuseModule = require("langfuse")
} catch {
  // Langfuse package not installed - this is expected and fine
}

/** The Langfuse class constructor, or null if not installed */
export const Langfuse = langfuseModule?.Langfuse ?? null

/** Whether the langfuse package is installed */
export const isInstalled = langfuseModule !== null

/** Re-export types for convenience (will be 'any' if not installed) */
export type LangfuseInstance = typeof Langfuse extends null
  ? null
  : InstanceType<NonNullable<typeof Langfuse>>

export type LangfuseTraceClient = LangfuseInstance extends null
  ? null
  : ReturnType<NonNullable<LangfuseInstance>["trace"]>

export type LangfuseSpanClient = LangfuseTraceClient extends null
  ? null
  : ReturnType<NonNullable<LangfuseTraceClient>["span"]>

export type LangfuseGenerationClient = LangfuseTraceClient extends null
  ? null
  : ReturnType<NonNullable<LangfuseTraceClient>["generation"]>

