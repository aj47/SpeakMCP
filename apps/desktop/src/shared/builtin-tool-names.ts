// Dependency-free constants for built-in tool names that may be referenced by both
// main and renderer code.

// The virtual server name for built-in tools (single source of truth; imported by main + renderer)
export const BUILTIN_SERVER_NAME = "speakmcp-settings"

export const MARK_WORK_COMPLETE_TOOL = `${BUILTIN_SERVER_NAME}:mark_work_complete`

// Internal completion nudge message: include in the LLM context, but hide from the progress UI.
// Keep this as a single canonical string so we can filter it via exact match (no false positives).
export const INTERNAL_COMPLETION_NUDGE_TEXT =
  `If all requested work is complete, call ${MARK_WORK_COMPLETE_TOOL} with a concise summary and then provide the final answer. Otherwise continue working and call more tools.`

