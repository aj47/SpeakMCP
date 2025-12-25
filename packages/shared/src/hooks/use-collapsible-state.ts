/**
 * SpeakMCP Shared Collapsible State Hook
 *
 * Consolidates common collapse/expand state logic used across the app.
 * Supports both single item and multi-item (Set-based) collapsible state.
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Options for useCollapsibleState hook
 */
export interface UseCollapsibleStateOptions {
  /** Initial collapsed state (default: true = collapsed) */
  defaultCollapsed?: boolean;
  /** External controlled value for collapsed state */
  isCollapsed?: boolean;
  /** Callback when toggle is triggered (for controlled mode) */
  onToggle?: () => void;
}

/**
 * Return type for useCollapsibleState hook
 */
export interface UseCollapsibleStateReturn {
  /** Whether the item is currently collapsed */
  isCollapsed: boolean;
  /** Whether the item is currently expanded (inverse of isCollapsed) */
  isExpanded: boolean;
  /** Toggle the collapsed state */
  toggle: () => void;
  /** Set collapsed state to true */
  collapse: () => void;
  /** Set collapsed state to false (expand) */
  expand: () => void;
  /** Set collapsed state directly */
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * Hook for managing single item collapsible state.
 * Supports both controlled and uncontrolled modes.
 *
 * @example
 * // Uncontrolled usage
 * const { isCollapsed, toggle } = useCollapsibleState({ defaultCollapsed: true });
 *
 * @example
 * // Controlled usage
 * const [collapsed, setCollapsed] = useState(true);
 * const { isCollapsed, toggle } = useCollapsibleState({
 *   isCollapsed: collapsed,
 *   onToggle: () => setCollapsed(prev => !prev)
 * });
 */
export function useCollapsibleState(
  options: UseCollapsibleStateOptions = {}
): UseCollapsibleStateReturn {
  const { defaultCollapsed = true, isCollapsed: controlledCollapsed, onToggle } = options;

  // Internal state for uncontrolled mode
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  // Use controlled value if provided, otherwise use internal state
  const isCollapsed = controlledCollapsed ?? internalCollapsed;
  const isExpanded = !isCollapsed;

  const toggle = useCallback(() => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  }, [onToggle]);

  const collapse = useCallback(() => {
    if (onToggle) {
      if (!isCollapsed) onToggle();
    } else {
      setInternalCollapsed(true);
    }
  }, [onToggle, isCollapsed]);

  const expand = useCallback(() => {
    if (onToggle) {
      if (isCollapsed) onToggle();
    } else {
      setInternalCollapsed(false);
    }
  }, [onToggle, isCollapsed]);

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      if (onToggle) {
        if (collapsed !== isCollapsed) onToggle();
      } else {
        setInternalCollapsed(collapsed);
      }
    },
    [onToggle, isCollapsed]
  );

  return {
    isCollapsed,
    isExpanded,
    toggle,
    collapse,
    expand,
    setCollapsed,
  };
}

/**
 * Options for useCollapsibleSet hook
 */
export interface UseCollapsibleSetOptions {
  /**
   * Initial set of item IDs to track.
   *
   * The meaning of this set depends on the `defaultItemExpanded` option:
   * - When `defaultItemExpanded` is `false` (default): These are the **expanded** item IDs.
   *   Items in the set are expanded, items not in the set are collapsed.
   * - When `defaultItemExpanded` is `true`: These are the **collapsed** item IDs (exceptions).
   *   Items in the set are collapsed, items not in the set are expanded.
   *
   * Default: empty set (all items follow the default state from `defaultItemExpanded`)
   */
  defaultExpanded?: Set<string> | string[];
  /**
   * Whether items should be expanded by default when not tracked in the set.
   *
   * - `false` (default): Items are collapsed by default. The set tracks which items are expanded.
   * - `true`: Items are expanded by default. The set tracks which items are collapsed (exceptions).
   *
   * Note: When `true`, `collapseAll()` cannot work without knowing all IDs.
   * Use `collapseAll(allIds)` or `setExpandedItems(new Set(allIds))` instead.
   */
  defaultItemExpanded?: boolean;
}

/**
 * Return type for useCollapsibleSet hook
 */
export interface UseCollapsibleSetReturn {
  /**
   * The internal set of tracked item IDs.
   *
   * Note: The meaning depends on `defaultItemExpanded`:
   * - When `false`: Contains expanded item IDs
   * - When `true`: Contains collapsed item IDs (exceptions)
   *
   * Prefer using `isExpanded()` and `isCollapsed()` for checking state.
   */
  expandedItems: Set<string>;
  /** Check if a specific item is expanded */
  isExpanded: (id: string) => boolean;
  /** Check if a specific item is collapsed */
  isCollapsed: (id: string) => boolean;
  /** Toggle a specific item's expanded state */
  toggle: (id: string) => void;
  /** Expand a specific item */
  expand: (id: string) => void;
  /** Collapse a specific item */
  collapse: (id: string) => void;
  /** Expand all items (provide all IDs when defaultItemExpanded is false) */
  expandAll: (ids: string[]) => void;
  /**
   * Collapse all items.
   *
   * @param ids - Required when `defaultItemExpanded` is `true`. All item IDs to collapse.
   *              Optional when `defaultItemExpanded` is `false` (clears the set).
   */
  collapseAll: (ids?: string[]) => void;
  /** Set the tracked items directly */
  setExpandedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * Hook for managing multiple items' collapsible state using a Set.
 * Useful for lists, accordions, or tree views.
 *
 * @example
 * const { isExpanded, toggle, expandAll, collapseAll } = useCollapsibleSet();
 *
 * // Check if item is expanded
 * if (isExpanded('item-1')) { ... }
 *
 * // Toggle item
 * <button onClick={() => toggle('item-1')}>Toggle</button>
 *
 * // Expand all
 * <button onClick={() => expandAll(['item-1', 'item-2', 'item-3'])}>Expand All</button>
 */
export function useCollapsibleSet(
  options: UseCollapsibleSetOptions = {}
): UseCollapsibleSetReturn {
  const { defaultExpanded = [], defaultItemExpanded = false } = options;

  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => {
    if (defaultExpanded instanceof Set) {
      return new Set(defaultExpanded);
    }
    return new Set(defaultExpanded);
  });

  const isExpanded = useCallback(
    (id: string): boolean => {
      if (defaultItemExpanded) {
        // If default is expanded, being in the set means collapsed
        return !expandedItems.has(id);
      }
      // If default is collapsed, being in the set means expanded
      return expandedItems.has(id);
    },
    [expandedItems, defaultItemExpanded]
  );

  const isCollapsed = useCallback((id: string): boolean => !isExpanded(id), [isExpanded]);

  const toggle = useCallback(
    (id: string) => {
      setExpandedItems((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    []
  );

  const expand = useCallback(
    (id: string) => {
      setExpandedItems((prev) => {
        if (defaultItemExpanded) {
          // Remove from set to expand
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        }
        // Add to set to expand
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    [defaultItemExpanded]
  );

  const collapse = useCallback(
    (id: string) => {
      setExpandedItems((prev) => {
        if (defaultItemExpanded) {
          // Add to set to collapse
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        }
        // Remove from set to collapse
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [defaultItemExpanded]
  );

  const expandAll = useCallback(
    (ids: string[]) => {
      if (defaultItemExpanded) {
        // Clear the set to expand all
        setExpandedItems(new Set());
      } else {
        // Add all IDs to expand all
        setExpandedItems(new Set(ids));
      }
    },
    [defaultItemExpanded]
  );

  const collapseAll = useCallback(
    (ids?: string[]) => {
      if (defaultItemExpanded) {
        if (!ids) {
          // In defaultItemExpanded mode, we need all IDs to collapse all
          // Without IDs, we cannot collapse - return early to avoid incorrect behavior
          console.warn(
            'collapseAll() requires all IDs in defaultItemExpanded mode. ' +
              'Call collapseAll(allIds) or use setExpandedItems(new Set(allIds)) instead.'
          );
          return;
        }
        // Add all IDs to the set to mark them as collapsed
        setExpandedItems(new Set(ids));
      } else {
        // Clear the set to collapse all
        setExpandedItems(new Set());
      }
    },
    [defaultItemExpanded]
  );

  return {
    expandedItems,
    isExpanded,
    isCollapsed,
    toggle,
    expand,
    collapse,
    expandAll,
    collapseAll,
    setExpandedItems,
  };
}
