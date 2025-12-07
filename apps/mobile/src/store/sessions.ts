/**
 * Session Store for Mobile App
 * Manages chat sessions with persistence using AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, SessionListItem, generateSessionId, generateMessageId, generateSessionTitle, sessionToListItem } from '../types/session';
import { ChatMessage } from '../lib/openaiClient';

const SESSIONS_KEY = 'chat_sessions_v1';
const CURRENT_SESSION_KEY = 'current_session_id_v1';

export interface SessionStore {
  sessions: Session[];
  currentSessionId: string | null;
  ready: boolean;
  
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
}

async function loadSessions(): Promise<Session[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveSessions(sessions: Session[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

async function loadCurrentSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CURRENT_SESSION_KEY);
  } catch {
    return null;
  }
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
    setSessions(prev => {
      const updated = [newSession, ...prev];
      saveSessions(updated);
      return updated;
    });
    setCurrentSessionIdState(newSession.id);
    saveCurrentSessionId(newSession.id);
    return newSession;
  }, []);

  const setCurrentSession = useCallback((id: string | null) => {
    setCurrentSessionIdState(id);
    saveCurrentSessionId(id);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      saveSessions(updated);
      return updated;
    });
    if (currentSessionId === id) {
      setCurrentSessionIdState(null);
      await saveCurrentSessionId(null);
    }
  }, [currentSessionId]);

  const clearAllSessions = useCallback(async () => {
    setSessions([]);
    setCurrentSessionIdState(null);
    await Promise.all([
      saveSessions([]),
      saveCurrentSessionId(null),
    ]);
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

  return {
    sessions,
    currentSessionId,
    ready,
    createNewSession,
    setCurrentSession,
    deleteSession,
    clearAllSessions,
    addMessage,
    getCurrentSession,
    getSessionList,
    setMessages,
  };
}

// Context for session store
export const SessionContext = createContext<SessionStore | null>(null);

export function useSessionContext(): SessionStore {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionContext missing');
  return ctx;
}

