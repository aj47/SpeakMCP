import { useState, useRef, useCallback, useEffect } from 'react';
import { ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

export interface ScrollAutomaticResult {
  scrollViewRef: React.RefObject<ScrollView>;
  shouldAutoScroll: boolean;
  setShouldAutoScroll: (value: boolean) => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  handleScrollBeginDrag: () => void;
  handleScrollEndDrag: () => void;
}

interface UseScrollAutomaticProps {
  messages: any[];
  currentSessionId: string | null;
}

export function useScrollAutomatic({ messages, currentSessionId }: UseScrollAutomaticProps): ScrollAutomaticResult {
  const scrollViewRef = useRef<ScrollView>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  
  // Track scroll timeout for debouncing rapid message updates
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track current auto-scroll state for use in timeout callbacks
  const shouldAutoScrollRef = useRef(true);
  // Track if user is actively dragging to distinguish from programmatic scrolls
  const isUserDraggingRef = useRef(false);
  // Track drag end timeout to prevent flaky behavior with rapid re-drags
  const dragEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    shouldAutoScrollRef.current = shouldAutoScroll;
    // Cancel any pending scroll when user disables auto-scroll
    if (!shouldAutoScroll && scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, [shouldAutoScroll]);

  // Handle user starting to drag the scroll view
  const handleScrollBeginDrag = useCallback(() => {
    // Clear any pending drag end timeout from previous drag
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
      dragEndTimeoutRef.current = null;
    }
    isUserDraggingRef.current = true;
  }, []);

  // Handle user ending drag - keep flag active briefly for momentum scroll
  const handleScrollEndDrag = useCallback(() => {
    // Clear any existing drag end timeout before scheduling a new one
    if (dragEndTimeoutRef.current) {
      clearTimeout(dragEndTimeoutRef.current);
    }
    // Clear the flag after a short delay to account for momentum scrolling
    dragEndTimeoutRef.current = setTimeout(() => {
      isUserDraggingRef.current = false;
      dragEndTimeoutRef.current = null;
    }, 150);
  }, []);

  // Handle scroll events to detect when user scrolls away from bottom
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Consider "at bottom" if within 50 pixels of the bottom
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;

    if (isAtBottom && !shouldAutoScroll) {
      // User scrolled back to bottom, resume auto-scroll
      setShouldAutoScroll(true);
    } else if (!isAtBottom && shouldAutoScroll && isUserDraggingRef.current) {
      // Only pause auto-scroll when user is actively dragging (not programmatic scroll)
      setShouldAutoScroll(false);
    }
  }, [shouldAutoScroll]);

  // Scroll to bottom when messages change and auto-scroll is enabled
  // Uses debouncing to handle rapid streaming updates efficiently
  useEffect(() => {
    if (shouldAutoScroll && scrollViewRef.current) {
      // Clear any pending scroll timeout to debounce rapid updates
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Schedule a new scroll with a short delay to batch rapid updates
      scrollTimeoutRef.current = setTimeout(() => {
        // Double-check auto-scroll is still enabled before scrolling
        if (shouldAutoScrollRef.current && scrollViewRef.current) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      }, 50);
    }
  }, [messages, shouldAutoScroll]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (dragEndTimeoutRef.current) {
        clearTimeout(dragEndTimeoutRef.current);
      }
    };
  }, []);

  // Reset auto-scroll when session changes
  useEffect(() => {
    setShouldAutoScroll(true);
    // Scroll to bottom when switching sessions
    const timeoutId = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [currentSessionId]);

  return {
    scrollViewRef,
    shouldAutoScroll,
    setShouldAutoScroll,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
  };
}
