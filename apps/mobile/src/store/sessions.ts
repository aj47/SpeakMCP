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

    // Use functional update to ensure we have the latest state and don't drop concurrent updates
    setSessions(prev => {
      // Filter out any sessions that are currently being deleted to avoid race conditions
      const cleanedPrev = prev.filter(s => !deletingSessionIds.has(s.id));
      const updated = [newSession, ...cleanedPrev];

      // Queue async saves to prevent interleaving with other operations
      // Note: We save inside the functional update to capture the exact state we're setting
      queueSave(async () => {
        await saveSessions(updated);
        await saveCurrentSessionId(newSession.id);
      });

      return updated;
    });
    setCurrentSessionIdState(newSession.id);

    return newSession;
  }, [deletingSessionIds, queueSave]);

  const setCurrentSession = useCallback((id: string | null) => {
    setCurrentSessionIdState(id);
    // Queue the async save to prevent interleaving with deleteSession's queued saves
    // This ensures that if a delete is in progress, the new selection won't be overwritten
    queueSave(async () => {
      await saveCurrentSessionId(id);
    });
  }, [queueSave]);

  const deleteSession = useCallback(async (id: string) => {
    // Mark session as being deleted to prevent race conditions
    setDeletingSessionIds(prev => new Set(prev).add(id));

    // Get current sessions from ref to avoid stale closure
    const currentSessions = sessionsRef.current;
    const updated = currentSessions.filter(s => s.id !== id);

    // Check if we're deleting the current session BEFORE any awaits
    // to avoid stale closure issues if user switches sessions during delete
    const wasCurrentSession = currentSessionIdRef.current === id;

    // Update state first
    setSessions(updated);
    if (wasCurrentSession) {
      setCurrentSessionIdState(null);
    }

    // Then await the async storage operations (queued to prevent interleaving)
    try {
      await new Promise<void>((resolve, reject) => {
        saveQueueRef.current = saveQueueRef.current
          .then(async () => {
            await saveSessions(updated);
            if (wasCurrentSession) {
              await saveCurrentSessionId(null);
            }
            resolve();
          })
          .catch(reject);
      });
    } finally {
      // Remove from deleting set after save completes
      setDeletingSessionIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const clearAllSessions = useCallback(async () => {
    // Mark all sessions as being deleted
    const allIds = new Set(sessionsRef.current.map(s => s.id));
    setDeletingSessionIds(allIds);

    setSessions([]);
    setCurrentSessionIdState(null);

    // Queue async saves to prevent interleaving
    try {
      await new Promise<void>((resolve, reject) => {
        saveQueueRef.current = saveQueueRef.current
          .then(async () => {
            await Promise.all([
              saveSessions([]),
              saveCurrentSessionId(null),
            ]);
            resolve();
          })
          .catch(reject);
      });
    } finally {
      setDeletingSessionIds(new Set());
    }
  }, []);

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

    setSessions(prev => {
      const updated = prev.map(session => {
        if (session.id !== currentSessionId) return session;

        const now = Date.now();
        const newMessage = {
          id: generateMessageId(),
          role,
          content,
          timestamp: now,
          toolCalls,
          toolResults,
        };

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
      saveSessions(updated);
      return updated;
    });
  }, [currentSessionId]);

  // Set messages directly (for updating from chat responses)
  const setMessages = useCallback(async (messages: ChatMessage[]) => {
    if (!currentSessionId) return;

    setSessions(prev => {
      const updated = prev.map(session => {
        if (session.id !== currentSessionId) return session;

        const now = Date.now();
        // Convert ChatMessage to session format
        const sessionMessages = messages.map((m, idx) => ({
          id: generateMessageId(),
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content || '',
          timestamp: now + idx,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
        }));

        // Update title from first user message if needed
        let title = session.title;
        const firstUserMsg = messages.find(m => m.role === 'user');
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
      saveSessions(updated);
      return updated;
    });
  }, [currentSessionId]);

  // Set the server-side conversation ID for the current session (fixes #501)
  const setServerConversationId = useCallback(async (serverConversationId: string) => {
    if (!currentSessionId) return;

    setSessions(prev => {
      const updated = prev.map(session => {
        if (session.id !== currentSessionId) return session;
        return {
          ...session,
          serverConversationId,
          updatedAt: Date.now(),
        };
      });
      saveSessions(updated);
      return updated;
    });
  }, [currentSessionId]);

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

