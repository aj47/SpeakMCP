/**
 * SpeakMCP Shared Collapsible State Hook
 *
 * Consolidates common collapse/expand state logic used across the app.
 * Supports both single item and multi-item (Set-based) collapsible state.
 */

import { useState, useCallback, Dispatch, SetStateAction } from 'react';

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
 */
export function useCollapsibleState(
  options: UseCollapsibleStateOptions = {}
): UseCollapsibleStateReturn {
  const { defaultCollapsed = true, isCollapsed: controlledCollapsed, onToggle } = options;

  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

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
   * Initial set of tracked item IDs.
   * - When defaultItemExpanded is false (default): these are the initially EXPANDED items
   * - When defaultItemExpanded is true: these are the initially COLLAPSED items (exceptions)
   */
  defaultExpanded?: Set<string> | string[];
  /**
   * Whether items should be expanded by default when not in the tracked set.
   * - false (default): items start collapsed, set tracks expanded items
   * - true: items start expanded, set tracks collapsed items (exceptions)
   */
  defaultItemExpanded?: boolean;
}

/**
 * Return type for useCollapsibleSet hook
 */
export interface UseCollapsibleSetReturn {
  /**
   * The internal set of tracked item IDs (readonly to prevent external mutation).
   * - When defaultItemExpanded is false: contains IDs of EXPANDED items
   * - When defaultItemExpanded is true: contains IDs of COLLAPSED items (exceptions)
   * Use isExpanded()/isCollapsed() for correct state checks regardless of mode.
   */
  trackedItems: ReadonlySet<string>;
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
  /** Expand all items (requires all IDs to set expanded state) */
  expandAll: (ids: string[]) => void;
  /** Collapse all items (requires all IDs to set collapsed state) */
  collapseAll: (ids: string[]) => void;
  /** Set the tracked items directly (see trackedItems for semantic meaning) */
  setTrackedItems: Dispatch<SetStateAction<Set<string>>>;
}

/**
 * Hook for managing multiple items' collapsible state using a Set.
 */
export function useCollapsibleSet(
  options: UseCollapsibleSetOptions = {}
): UseCollapsibleSetReturn {
  const { defaultExpanded = [], defaultItemExpanded = false } = options;

  const [trackedItems, setTrackedItems] = useState<Set<string>>(() => {
    if (defaultExpanded instanceof Set) {
      return new Set(defaultExpanded);
    }
    return new Set(defaultExpanded);
  });

  const isExpanded = useCallback(
    (id: string): boolean => {
      if (defaultItemExpanded) {
        // In defaultItemExpanded mode, items in set are collapsed (exceptions)
        return !trackedItems.has(id);
      }
      // In normal mode, items in set are expanded
      return trackedItems.has(id);
    },
    [trackedItems, defaultItemExpanded]
  );

  const isCollapsed = useCallback((id: string): boolean => !isExpanded(id), [isExpanded]);

  const toggle = useCallback((id: string) => {
    setTrackedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expand = useCallback(
    (id: string) => {
      setTrackedItems((prev) => {
        if (defaultItemExpanded) {
          // In defaultItemExpanded mode, expanding means removing from tracked (collapsed) set
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        }
        // In normal mode, expanding means adding to tracked (expanded) set
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
      setTrackedItems((prev) => {
        if (defaultItemExpanded) {
          // In defaultItemExpanded mode, collapsing means adding to tracked (collapsed) set
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        }
        // In normal mode, collapsing means removing from tracked (expanded) set
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
        // In defaultItemExpanded mode, expanding all means clearing tracked (collapsed) set
        setTrackedItems(new Set());
      } else {
        // In normal mode, expanding all means adding all to tracked (expanded) set
        setTrackedItems(new Set(ids));
      }
    },
    [defaultItemExpanded]
  );

  const collapseAll = useCallback(
    (ids: string[]) => {
      if (defaultItemExpanded) {
        // In defaultItemExpanded mode, collapsing all means adding all to tracked (collapsed) set
        setTrackedItems(new Set(ids));
      } else {
        // In normal mode, collapsing all means clearing tracked (expanded) set
        setTrackedItems(new Set());
      }
    },
    [defaultItemExpanded]
  );

  return {
    trackedItems: trackedItems as ReadonlySet<string>,
    isExpanded,
    isCollapsed,
    toggle,
    expand,
    collapse,
    expandAll,
    collapseAll,
    setTrackedItems,
  };
}

