import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppConfig = {
  apiKey: string;
  baseUrl: string; // OpenAI-compatible API base URL e.g., https://api.openai.com/v1
  model: string; // model name required by /v1/chat/completions
  handsFree?: boolean; // hands-free voice mode toggle (optional for backward compatibility)
  ttsEnabled?: boolean; // text-to-speech toggle (optional for backward compatibility)
};

const DEFAULTS: AppConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  handsFree: false,
  ttsEnabled: true,
};

const STORAGE_KEY = 'app_config_v1';

export async function loadConfig(): Promise<AppConfig> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed } as AppConfig;
  } catch {
    return DEFAULTS;
  }
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

