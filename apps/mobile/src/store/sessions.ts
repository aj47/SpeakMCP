import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Session, SessionListItem, generateSessionId, generateMessageId, generateSessionTitle, sessionToListItem } from '../types/session';
import { ChatMessage } from '../lib/openaiClient';

const SESSIONS_KEY = 'chat_sessions_v1';
const CURRENT_SESSION_KEY = 'current_session_id_v1';

export interface SessionStore {
  sessions: Session[];
  currentSessionId: string | null;
  ready: boolean;
  /** Set of session IDs that are currently being deleted (prevents race conditions) */
  deletingSessionIds: Set<string>;

  // Session management
  createNewSession: () => Session;
  setCurrentSession: (id: string | null) => void;
  deleteSession: (id: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;

  // Message management
  addMessage: (role: 'user' | 'assistant', content: string, toolCalls?: any[], toolResults?: any[]) => Promise<void>;
  getCurrentSession: () => Session | null;
  getSessionList: () => SessionListItem[];
  setMessages: (messages: ChatMessage[]) => Promise<void>;

  // Server conversation ID management (for continuing conversations with SpeakMCP server)
  setServerConversationId: (serverConversationId: string) => Promise<void>;
  getServerConversationId: () => string | undefined;
}

async function loadSessions(): Promise<Session[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {}
  return [];
}

async function saveSessions(sessions: Session[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

async function loadCurrentSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CURRENT_SESSION_KEY);
  } catch {}
  return null;
}

async function saveCurrentSessionId(id: string | null): Promise<void> {
  if (id) {
    await AsyncStorage.setItem(CURRENT_SESSION_KEY, id);
  } else {
    await AsyncStorage.removeItem(CURRENT_SESSION_KEY);
  }
}

export function useSessions(): SessionStore {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Track sessions being deleted to prevent race conditions (fixes #571)
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(new Set());
  // Use ref to ensure we always have the latest sessions for async operations
  // NOTE: We update these refs synchronously in our callbacks, not just in useEffect,
  // to ensure queued async saves always see the correct state (fixes PR review comment)
  const sessionsRef = useRef<Session[]>(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  // Use ref for currentSessionId to avoid stale closure issues after awaits
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  // Serialize async storage writes to prevent interleaving (fixes PR review comment)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Helper to queue async save operations to prevent interleaving
  const queueSave = useCallback((saveOperation: () => Promise<void>): void => {
    saveQueueRef.current = saveQueueRef.current
      .then(saveOperation)
      .catch(err => console.error('[sessions] Save operation failed:', err));
  }, []);

  // Load sessions on mount
  useEffect(() => {
    (async () => {
      const [loadedSessions, loadedCurrentId] = await Promise.all([
        loadSessions(),
        loadCurrentSessionId(),
      ]);
      // Update refs synchronously BEFORE setting state to prevent stale refs
      // This fixes the race condition where createNewSession could read empty sessionsRef.current
      // if called immediately after mount (before the useEffect that syncs refs from state runs)
      sessionsRef.current = loadedSessions;
      currentSessionIdRef.current = loadedCurrentId;
      setSessions(loadedSessions);
      setCurrentSessionIdState(loadedCurrentId);
      setReady(true);
    })();
  }, []);

  const createNewSession = useCallback((): Session => {
    const now = Date.now();
    const newSession: Session = {
      id: generateSessionId(),
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    // Compute the new sessions array BEFORE setSessions to guarantee the value we save
    // is exactly what we intend to set (fixes PR review: avoids React updater timing race)
    const currentSessions = sessionsRef.current;
    const cleanedPrev = currentSessions.filter(s => !deletingSessionIds.has(s.id));
    const sessionsToSave = [newSession, ...cleanedPrev];

    // Update ref synchronously so any subsequent operations see the new state immediately
    sessionsRef.current = sessionsToSave;

    // Use functional update for state to ensure React's reconciliation works correctly
    // The functional update also serves as a safeguard against stale closures in edge cases
    setSessions(prev => {
      // Re-filter to handle any edge case where state diverged from ref
      const freshCleanedPrev = prev.filter(s => !deletingSessionIds.has(s.id));
      return [newSession, ...freshCleanedPrev];
    });

    setCurrentSessionIdState(newSession.id);
    // Update currentSessionId ref synchronously as well
    currentSessionIdRef.current = newSession.id;

    // Queue async saves with the pre-computed sessions array (guaranteed correct value)
    queueSave(async () => {
      await saveSessions(sessionsToSave);
      await saveCurrentSessionId(newSession.id);
    });

    return newSession;
  }, [deletingSessionIds, queueSave]);

  const setCurrentSession = useCallback((id: string | null) => {
    setCurrentSessionIdState(id);
    // Update ref synchronously so queued saves see the new value immediately
    currentSessionIdRef.current = id;
    // Queue the async save to prevent interleaving with deleteSession's queued saves
    // This ensures that if a delete is in progress, the new selection won't be overwritten
    queueSave(async () => {
      await saveCurrentSessionId(id);
    });
  }, [queueSave]);

  const deleteSession = useCallback(async (id: string) => {
    // Mark session as being deleted to prevent race conditions
    setDeletingSessionIds(prev => new Set(prev).add(id));

    // Check if we're deleting the current session for immediate UI update
    const isCurrentSession = currentSessionIdRef.current === id;

    // Update current session state immediately for responsive UI
    if (isCurrentSession) {
      setCurrentSessionIdState(null);
      // Update ref synchronously so queued saves see the new value immediately
      currentSessionIdRef.current = null;
    }

    // Compute the new sessions array BEFORE setSessions to guarantee the value we save
    // is exactly what we intend to set (fixes PR review: avoids React updater timing race)
    const currentSessions = sessionsRef.current;
    const sessionsToSave = currentSessions.filter(s => s.id !== id);

    // Update ref synchronously so any subsequent operations see the new state immediately
    sessionsRef.current = sessionsToSave;

    // Use functional update for state to ensure React's reconciliation works correctly
    setSessions(prev => prev.filter(s => s.id !== id));

    // Queue save with the pre-computed sessions array (guaranteed correct value)
    queueSave(async () => {
      await saveSessions(sessionsToSave);
      // Re-check currentSessionIdRef at save time to avoid overwriting newly selected session
      // Only clear persisted ID if user hasn't switched to a different session
      // This fixes the race where user switches sessions while delete is in-flight
      const currentIdAtSaveTime = currentSessionIdRef.current;
      if (currentIdAtSaveTime === null || currentIdAtSaveTime === id) {
        await saveCurrentSessionId(null);
      }
    });

    // Wait for the queued save to complete before removing from deleting set
    // Since queueSave is now called synchronously above, this await will correctly
    // wait for the delete save operation to complete
    try {
      await new Promise<void>((resolve, reject) => {
        saveQueueRef.current = saveQueueRef.current.then(resolve).catch(reject);
      });
    } finally {
      // Remove from deleting set after save completes
      setDeletingSessionIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [queueSave]);

  const clearAllSessions = useCallback(async () => {
    // Mark all sessions as being deleted
    const allIds = new Set(sessionsRef.current.map(s => s.id));
    setDeletingSessionIds(allIds);

    setSessions([]);
    setCurrentSessionIdState(null);
    // Update refs synchronously so queued saves see the new values immediately
    sessionsRef.current = [];
    currentSessionIdRef.current = null;

    // Queue async saves to prevent interleaving - save empty array directly (no ref needed)
    queueSave(async () => {
      await Promise.all([
        saveSessions([]),
        saveCurrentSessionId(null),
      ]);
    });

    // Wait for the queued save to complete before clearing the deleting set
    try {
      await new Promise<void>((resolve, reject) => {
        saveQueueRef.current = saveQueueRef.current.then(resolve).catch(reject);
      });
    } finally {
      setDeletingSessionIds(new Set());
    }
  }, [queueSave]);

  const getCurrentSession = useCallback((): Session | null => {
    if (!currentSessionId) return null;
    return sessions.find(s => s.id === currentSessionId) || null;
  }, [sessions, currentSessionId]);

  const getSessionList = useCallback((): SessionListItem[] => {
    return sessions.map(sessionToListItem);
  }, [sessions]);

  const addMessage = useCallback(async (
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: any[],
    toolResults?: any[]
  ) => {
    if (!currentSessionId) return;

    // Create the message ONCE to ensure consistency between persisted and React state
    const now = Date.now();
    const newMessage = {
      id: generateMessageId(),
      role,
      content,
      timestamp: now,
      toolCalls,
      toolResults,
    };

    // Compute the new sessions array BEFORE setSessions to guarantee the value we save
    // is exactly what we intend to set (same pattern as createNewSession/deleteSession)
    const currentSessions = sessionsRef.current;
    const targetSessionId = currentSessionId;
    const sessionsToSave = currentSessions.map(session => {
      if (session.id !== targetSessionId) return session;

      // Update title if this is the first user message
      let title = session.title;
      if (role === 'user' && session.messages.length === 0) {
        title = generateSessionTitle(content);
      }

      return {
        ...session,
        title,
        updatedAt: now,
        messages: [...session.messages, newMessage],
      };
    });

    // Update ref synchronously so any subsequent operations see the new state immediately
    sessionsRef.current = sessionsToSave;

    // Set state to the pre-computed sessions array to ensure React state matches persisted state
    setSessions(sessionsToSave);

    // Queue async save with the pre-computed sessions array (serialized with other operations)
    queueSave(async () => {
      await saveSessions(sessionsToSave);
    });
  }, [currentSessionId, queueSave]);

  // Set messages directly (for updating from chat responses)
  const setMessages = useCallback(async (messages: ChatMessage[]) => {
    if (!currentSessionId) return;

    // Compute the new sessions array BEFORE setSessions to guarantee the value we save
    // is exactly what we intend to set (same pattern as createNewSession/deleteSession)
    const currentSessions = sessionsRef.current;
    const targetSessionId = currentSessionId;
    const now = Date.now();

    // Pre-compute session messages for consistency
    const sessionMessages = messages.map((m, idx) => ({
      id: generateMessageId(),
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content || '',
      timestamp: now + idx,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults,
    }));

    const firstUserMsg = messages.find(m => m.role === 'user');

    const sessionsToSave = currentSessions.map(session => {
      if (session.id !== targetSessionId) return session;

      // Update title from first user message if needed
      let title = session.title;
      if (title === 'New Chat' && firstUserMsg?.content) {
        title = generateSessionTitle(firstUserMsg.content);
      }

      return {
        ...session,
        title,
        updatedAt: now,
        messages: sessionMessages,
      };
    });

    // Update ref synchronously so any subsequent operations see the new state immediately
    sessionsRef.current = sessionsToSave;

    // Use functional update for state - return the pre-computed sessionsToSave directly
    // to guarantee state matches what we're saving (same pattern as addMessage)
    setSessions(() => sessionsToSave);

    // Queue async save with the pre-computed sessions array (serialized with other operations)
    queueSave(async () => {
      await saveSessions(sessionsToSave);
    });
  }, [currentSessionId, queueSave]);

  // Set the server-side conversation ID for the current session (fixes #501)
  const setServerConversationId = useCallback(async (serverConversationId: string) => {
    if (!currentSessionId) return;

    // Compute the new sessions array BEFORE setSessions to guarantee the value we save
    // is exactly what we intend to set (same pattern as createNewSession/deleteSession)
    const currentSessions = sessionsRef.current;
    const targetSessionId = currentSessionId;
    const now = Date.now();

    const sessionsToSave = currentSessions.map(session => {
      if (session.id !== targetSessionId) return session;
      return {
        ...session,
        serverConversationId,
        updatedAt: now,
      };
    });

    // Update ref synchronously so any subsequent operations see the new state immediately
    sessionsRef.current = sessionsToSave;

    // Use functional update for state - return the pre-computed sessionsToSave directly
    // to guarantee state matches what we're saving (same pattern as addMessage)
    setSessions(() => sessionsToSave);

    // Queue async save with the pre-computed sessions array (serialized with other operations)
    queueSave(async () => {
      await saveSessions(sessionsToSave);
    });
  }, [currentSessionId, queueSave]);

  // Get the server-side conversation ID for the current session
  const getServerConversationId = useCallback((): string | undefined => {
    const session = getCurrentSession();
    return session?.serverConversationId;
  }, [getCurrentSession]);

  return {
    sessions,
    currentSessionId,
    ready,
    deletingSessionIds,
    createNewSession,
    setCurrentSession,
    deleteSession,
    clearAllSessions,
    addMessage,
    getCurrentSession,
    getSessionList,
    setMessages,
    setServerConversationId,
    getServerConversationId,
  };
}

// Context for session store
export const SessionContext = createContext<SessionStore | null>(null);

export function useSessionContext(): SessionStore {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionContext missing');
  return ctx;
}

