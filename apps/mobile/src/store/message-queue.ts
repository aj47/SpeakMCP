/**
 * Message Queue Store for Mobile
 * 
 * Manages a queue of messages to be sent when the agent is busy processing.
 * This is a local-only queue (no persistence) since messages are processed
 * sequentially and cleared after successful send.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { QueuedMessage } from '@speakmcp/shared';

// Generate unique message ID
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export interface MessageQueueStore {
  /** Map of conversation ID to queued messages */
  queues: Map<string, QueuedMessage[]>;
  
  /** Add a message to the queue for a conversation */
  enqueue: (conversationId: string, text: string) => QueuedMessage;
  
  /** Get all queued messages for a conversation */
  getQueue: (conversationId: string) => QueuedMessage[];
  
  /** Remove a specific message from the queue */
  removeFromQueue: (conversationId: string, messageId: string) => boolean;
  
  /** Clear all messages for a conversation */
  clearQueue: (conversationId: string) => void;
  
  /** Update the text of a queued message */
  updateText: (conversationId: string, messageId: string, text: string) => boolean;
  
  /** Peek at the next message to process (returns first pending message) */
  peek: (conversationId: string) => QueuedMessage | null;
  
  /** Mark a message as processing */
  markProcessing: (conversationId: string, messageId: string) => boolean;
  
  /** Mark a message as processed and remove it from the queue */
  markProcessed: (conversationId: string, messageId: string) => boolean;
  
  /** Mark a message as failed */
  markFailed: (conversationId: string, messageId: string, errorMessage: string) => boolean;
  
  /** Reset a failed message to pending for retry */
  resetToPending: (conversationId: string, messageId: string) => boolean;
  
  /** Check if a conversation has queued messages */
  hasQueuedMessages: (conversationId: string) => boolean;
}

export function useMessageQueue(): MessageQueueStore {
  const [queues, setQueues] = useState<Map<string, QueuedMessage[]>>(new Map());
  const queuesRef = useRef<Map<string, QueuedMessage[]>>(queues);
  
  // Keep ref in sync
  queuesRef.current = queues;
  
  const enqueue = useCallback((conversationId: string, text: string): QueuedMessage => {
    const message: QueuedMessage = {
      id: generateMessageId(),
      conversationId,
      text,
      createdAt: Date.now(),
      status: 'pending',
    };
    
    setQueues(prev => {
      const newMap = new Map(prev);
      const queue = [...(prev.get(conversationId) || []), message];
      newMap.set(conversationId, queue);
      return newMap;
    });
    
    console.log('[MessageQueue] Enqueued message:', message.id);
    return message;
  }, []);
  
  const getQueue = useCallback((conversationId: string): QueuedMessage[] => {
    return queuesRef.current.get(conversationId) || [];
  }, []);
  
  const removeFromQueue = useCallback((conversationId: string, messageId: string): boolean => {
    // Check synchronously using ref to determine if removal will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Don't allow removing a message that's currently processing
    if (queue[index].status === 'processing') return false;

    // Removal will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const newQueue = currentQueue.filter(m => m.id !== messageId);
      const newMap = new Map(prev);
      if (newQueue.length === 0) {
        newMap.delete(conversationId);
      } else {
        newMap.set(conversationId, newQueue);
      }
      return newMap;
    });

    console.log('[MessageQueue] Removed message:', messageId);
    return true;
  }, []);
  
  const clearQueue = useCallback((conversationId: string): void => {
    setQueues(prev => {
      const queue = prev.get(conversationId);
      if (!queue) return prev;
      
      // Don't clear if there's a processing message
      if (queue.some(m => m.status === 'processing')) return prev;
      
      const newMap = new Map(prev);
      newMap.delete(conversationId);
      return newMap;
    });
    console.log('[MessageQueue] Cleared queue for:', conversationId);
  }, []);
  
  const updateText = useCallback((conversationId: string, messageId: string, text: string): boolean => {
    // Check synchronously using ref to determine if update will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Don't allow editing a message that's processing or already added to history
    const msg = queue[index];
    if (msg.status === 'processing' || msg.addedToHistory) return false;

    // Update will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const idx = currentQueue.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;

      const newQueue = [...currentQueue];
      newQueue[idx] = { ...newQueue[idx], text };
      const newMap = new Map(prev);
      newMap.set(conversationId, newQueue);
      return newMap;
    });

    return true;
  }, []);
  
  const peek = useCallback((conversationId: string): QueuedMessage | null => {
    const queue = queuesRef.current.get(conversationId);
    if (!queue || queue.length === 0) return null;
    // Only return first message if it's pending (FIFO ordering)
    const first = queue[0];
    return first.status === 'pending' ? first : null;
  }, []);

  const markProcessing = useCallback((conversationId: string, messageId: string): boolean => {
    // Check synchronously using ref to determine if marking will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Mark will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const idx = currentQueue.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;

      const newQueue = [...currentQueue];
      newQueue[idx] = { ...newQueue[idx], status: 'processing' };
      const newMap = new Map(prev);
      newMap.set(conversationId, newQueue);
      return newMap;
    });

    return true;
  }, []);

  const markProcessed = useCallback((conversationId: string, messageId: string): boolean => {
    // Check synchronously using ref to determine if marking will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Mark will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const newQueue = currentQueue.filter(m => m.id !== messageId);
      const newMap = new Map(prev);
      if (newQueue.length === 0) {
        newMap.delete(conversationId);
      } else {
        newMap.set(conversationId, newQueue);
      }
      return newMap;
    });

    console.log('[MessageQueue] Marked processed:', messageId);
    return true;
  }, []);

  const markFailed = useCallback((conversationId: string, messageId: string, errorMessage: string): boolean => {
    // Check synchronously using ref to determine if marking will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Mark will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const idx = currentQueue.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;

      const newQueue = [...currentQueue];
      newQueue[idx] = { ...newQueue[idx], status: 'failed', errorMessage };
      const newMap = new Map(prev);
      newMap.set(conversationId, newQueue);
      return newMap;
    });

    console.log('[MessageQueue] Marked failed:', messageId, errorMessage);
    return true;
  }, []);

  const resetToPending = useCallback((conversationId: string, messageId: string): boolean => {
    // Check synchronously using ref to determine if reset will succeed
    const queue = queuesRef.current.get(conversationId);
    if (!queue) return false;

    const index = queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    // Reset will succeed - perform the state update
    setQueues(prev => {
      const currentQueue = prev.get(conversationId);
      if (!currentQueue) return prev;

      const idx = currentQueue.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;

      const newQueue = [...currentQueue];
      newQueue[idx] = { ...newQueue[idx], status: 'pending', errorMessage: undefined };
      const newMap = new Map(prev);
      newMap.set(conversationId, newQueue);
      return newMap;
    });

    console.log('[MessageQueue] Reset to pending:', messageId);
    return true;
  }, []);

  const hasQueuedMessages = useCallback((conversationId: string): boolean => {
    const queue = queuesRef.current.get(conversationId);
    return !!queue && queue.length > 0;
  }, []);

  return {
    queues,
    enqueue,
    getQueue,
    removeFromQueue,
    clearQueue,
    updateText,
    peek,
    markProcessing,
    markProcessed,
    markFailed,
    resetToPending,
    hasQueuedMessages,
  };
}

// Context for message queue store
export const MessageQueueContext = createContext<MessageQueueStore | null>(null);

export function useMessageQueueContext(): MessageQueueStore {
  const ctx = useContext(MessageQueueContext);
  if (!ctx) throw new Error('MessageQueueContext missing');
  return ctx;
}

