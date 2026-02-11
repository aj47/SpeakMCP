import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppConfig = {
  apiKey: string;
  baseUrl: string; // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  model: string; // model name required by /v1/chat/completions
  handsFree?: boolean; // hands-free voice mode toggle (optional for backward compatibility)
  ttsEnabled?: boolean; // text-to-speech toggle (optional for backward compatibility)
  messageQueueEnabled?: boolean; // message queue toggle (allows queuing messages while agent is busy)
  // TTS voice settings
  ttsVoiceId?: string; // Voice identifier (e.g., "Google US English" or native voice URI)
  ttsRate?: number; // Speech rate (0.1 to 10, default 1.0)
  ttsPitch?: number; // Voice pitch (0 to 2, default 1.0)
};

const DEFAULTS: AppConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  handsFree: false,
  ttsEnabled: true,
  messageQueueEnabled: true,
  ttsVoiceId: undefined, // Use system default
  ttsRate: 1.0,
  ttsPitch: 1.0,
};

const STORAGE_KEY = 'app_config_v1';

export async function loadConfig(): Promise<AppConfig> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed } as AppConfig;
  } catch {}
  return DEFAULTS;
}

export async function saveConfig(cfg: AppConfig) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setConfig(cfg);
      setReady(true);
    })();
  }, []);

  return { config, setConfig, ready } as const;
}

export const ConfigContext = createContext<ReturnType<typeof useConfig> | null>(null);
export function useConfigContext() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('ConfigContext missing');
  return ctx;
}

