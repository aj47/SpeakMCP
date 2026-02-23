// Keep this module dependency-light so it can be unit-tested without pulling in
// Electron-only code.

export type ToolLike = { name: string }

/**
 * Defensive filter: given a list of named items (e.g. toolCalls from an LLM response)
 * and the list of tools that were actually provided, removes any items whose name
 * is not in the allowed set.
 *
 * This guards against the JSON-fallback path in llm-fetch.ts which can synthesize
 * toolCalls by parsing JSON-like text output — those may reference tools that were
 * not actually available.
 */
export function filterNamedItemsToAllowedTools<TItem extends { name: string }, TTool extends ToolLike>(
  items: TItem[] | undefined,
  allowedTools: TTool[],
): { allowed: TItem[]; removed: TItem[] } {
  const input = Array.isArray(items) ? items : []
  if (input.length === 0) return { allowed: [], removed: [] }

  const allowedNames = new Set(allowedTools.map((t) => t.name))
  const allowed: TItem[] = []
  const removed: TItem[] = []

  for (const item of input) {
    if (item && typeof item.name === "string" && allowedNames.has(item.name)) {
      allowed.push(item)
    } else {
      removed.push(item)
    }
  }

  return { allowed, removed }
}

