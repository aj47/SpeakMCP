/**
 * Profile context for tracking the current profile from the SpeakMCP server.
 * 
 * This provides app-wide access to the current profile name so it can be
 * displayed prominently in chat sessions (issue #837).
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { SettingsApiClient, Profile } from '../lib/settingsApi';

export interface ProfileContextValue {
  /** Current profile from the server */
  currentProfile: Profile | null;
  /** Whether the profile is being loaded */
  isLoading: boolean;
  /** Error message if profile fetch failed */
  error: string | null;
  /** Refresh the profile from the server */
  refresh: () => Promise<void>;
  /** Update the current profile (when changed in settings) */
  setCurrentProfile: (profile: Profile | null) => void;
}

const defaultValue: ProfileContextValue = {
  currentProfile: null,
  isLoading: false,
  error: null,
  refresh: async () => {},
  setCurrentProfile: () => {},
};

export const ProfileContext = createContext<ProfileContextValue>(defaultValue);

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}

/**
 * Hook to create the profile context provider value.
 * Should be used at the app root level.
 */
export function useProfileProvider(baseUrl: string, apiKey: string): ProfileContextValue {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track the current credentials to detect changes
  const credentialsRef = useRef({ baseUrl, apiKey });
  // Track whether we've already fetched for the current credentials
  // This prevents infinite refetch loops when the endpoint returns 404
  const hasFetchedRef = useRef(false);
  
  const refresh = useCallback(async () => {
    // Only fetch if we have valid credentials
    if (!baseUrl || !apiKey) {
      setCurrentProfile(null);
      setError(null);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const client = new SettingsApiClient(baseUrl, apiKey);
      const profile = await client.getCurrentProfile();
      setCurrentProfile(profile);
    } catch (err: any) {
      console.warn('[Profile] Failed to fetch current profile:', err);
      // Don't set error for network issues - just leave profile null
      // This prevents showing errors when not connected to a SpeakMCP server
      if (err?.message?.includes('not found') || err?.message?.includes('404')) {
        // Server doesn't support profile endpoint - that's okay
        setCurrentProfile(null);
      } else {
        setError(err?.message || 'Failed to fetch profile');
      }
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, apiKey]);
  
  // Fetch profile when credentials change
  useEffect(() => {
    const credentialsChanged = 
      credentialsRef.current.baseUrl !== baseUrl ||
      credentialsRef.current.apiKey !== apiKey;
    
    if (credentialsChanged) {
      credentialsRef.current = { baseUrl, apiKey };
      // Reset the fetch flag when credentials change so we fetch with new credentials
      hasFetchedRef.current = false;
    }
    
    // Only fetch if we haven't already fetched for these credentials
    // This prevents infinite loops when 404 sets currentProfile to null
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      refresh();
    }
  }, [baseUrl, apiKey, refresh]);
  
  return {
    currentProfile,
    isLoading,
    error,
    refresh,
    setCurrentProfile,
  };
}

