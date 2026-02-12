/**
 * Settings API client for communicating with the desktop app's remote server.
 * Provides methods for managing profiles, MCP servers, and settings.
 */

export interface Profile {
  id: string;
  name: string;
  isDefault?: boolean;
  guidelines?: string;
  systemPrompt?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ProfilesResponse {
  profiles: Profile[];
  currentProfileId?: string;
}

export interface MCPServer {
  name: string;
  connected: boolean;
  toolCount: number;
  enabled: boolean;
  runtimeEnabled: boolean;
  configDisabled: boolean;
  error?: string;
}

export interface MCPServersResponse {
  servers: MCPServer[];
}

export interface ModelPreset {
  id: string;
  name: string;
  baseUrl: string;
  isBuiltIn: boolean;
}

export interface Settings {
  mcpToolsProviderId: 'openai' | 'groq' | 'gemini';
  mcpToolsOpenaiModel?: string;
  mcpToolsGroqModel?: string;
  mcpToolsGeminiModel?: string;
  currentModelPresetId?: string;
  availablePresets?: ModelPreset[];
  transcriptPostProcessingEnabled: boolean;
  mcpRequireApprovalBeforeToolCall: boolean;
  ttsEnabled: boolean;
  whatsappEnabled: boolean;
  mcpMaxIterations: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
}

export interface ModelsResponse {
  providerId: string;
  models: ModelInfo[];
}

// Conversation Sync Types
export interface ServerConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

export interface ServerConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
  preview?: string;
}

export interface ServerConversationFull {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ServerConversationMessage[];
  metadata?: Record<string, unknown>;
}

export interface CreateConversationRequest {
  title?: string;
  messages: ServerConversationMessage[];
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdateConversationRequest {
  title?: string;
  messages?: ServerConversationMessage[];
  updatedAt?: number;
}

export interface SettingsUpdate {
  transcriptPostProcessingEnabled?: boolean;
  mcpRequireApprovalBeforeToolCall?: boolean;
  ttsEnabled?: boolean;
  whatsappEnabled?: boolean;
  mcpMaxIterations?: number;
  mcpToolsProviderId?: 'openai' | 'groq' | 'gemini';
  mcpToolsOpenaiModel?: string;
  mcpToolsGroqModel?: string;
  mcpToolsGeminiModel?: string;
  currentModelPresetId?: string;
}

export class SettingsApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.authHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // Profile Management
  async getProfiles(): Promise<ProfilesResponse> {
    return this.request<ProfilesResponse>('/profiles');
  }

  async getCurrentProfile(): Promise<Profile> {
    return this.request<Profile>('/profiles/current');
  }

  async setCurrentProfile(profileId: string): Promise<{ success: boolean; profile: Profile }> {
    return this.request('/profiles/current', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
  }

  async exportProfile(profileId: string): Promise<{ profileJson: string }> {
    return this.request<{ profileJson: string }>(`/profiles/${encodeURIComponent(profileId)}/export`);
  }

  async importProfile(profileJson: string): Promise<{ success: boolean; profile: Profile }> {
    return this.request('/profiles/import', {
      method: 'POST',
      body: JSON.stringify({ profileJson }),
    });
  }

  // MCP Server Management
  async getMCPServers(): Promise<MCPServersResponse> {
    return this.request<MCPServersResponse>('/mcp/servers');
  }

  async toggleMCPServer(serverName: string, enabled: boolean): Promise<{ success: boolean; server: string; enabled: boolean }> {
    return this.request(`/mcp/servers/${encodeURIComponent(serverName)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  // Settings Management
  async getSettings(): Promise<Settings> {
    return this.request<Settings>('/settings');
  }

  async updateSettings(updates: SettingsUpdate): Promise<{ success: boolean; updated: string[] }> {
    return this.request('/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // Models Management
  async getModels(providerId: 'openai' | 'groq' | 'gemini'): Promise<ModelsResponse> {
    return this.request<ModelsResponse>(`/models/${providerId}`);
  }

  // Conversation Sync Management
  async getConversations(): Promise<{ conversations: ServerConversation[] }> {
    return this.request<{ conversations: ServerConversation[] }>('/conversations');
  }

  async getConversation(id: string): Promise<ServerConversationFull> {
    return this.request<ServerConversationFull>(`/conversations/${encodeURIComponent(id)}`);
  }

  async createConversation(data: CreateConversationRequest): Promise<ServerConversationFull> {
    return this.request<ServerConversationFull>('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateConversation(id: string, data: UpdateConversationRequest): Promise<ServerConversationFull> {
    return this.request<ServerConversationFull>(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

// Push notification registration/unregistration
export interface PushTokenRegistration {
  token: string;
  type: 'expo';
  platform: 'ios' | 'android';
  deviceId?: string;
}

export interface PushStatusResponse {
  enabled: boolean;
  tokenCount: number;
  platforms: string[];
}

// External Session Types (for unified conversation history)
export type ExternalSessionSource = 'augment' | 'claude-code' | 'speakmcp';

export interface UnifiedConversation extends ServerConversation {
  source: ExternalSessionSource;
  workspacePath?: string;
  filePath?: string;
}

export interface ExternalSessionProvider {
  source: ExternalSessionSource;
  displayName: string;
}

export interface ContinueSessionResult {
  success: boolean;
  message?: string;
  error?: string;
}

// Extended client with push notification and external session methods
export class ExtendedSettingsApiClient extends SettingsApiClient {
  // External Session Management (unified conversation history)
  async getUnifiedConversations(limit?: number): Promise<{ conversations: UnifiedConversation[] }> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<{ conversations: UnifiedConversation[] }>(`/conversations/unified${query}`);
  }

  async getExternalSessionProviders(): Promise<{ providers: ExternalSessionProvider[] }> {
    return this.request<{ providers: ExternalSessionProvider[] }>('/external-sessions/providers');
  }

  async continueExternalSession(
    sessionId: string,
    source: ExternalSessionSource,
    workspacePath?: string
  ): Promise<ContinueSessionResult> {
    return this.request<ContinueSessionResult>('/external-sessions/continue', {
      method: 'POST',
      body: JSON.stringify({ sessionId, source, workspacePath }),
    });
  }
  // Register push notification token
  async registerPushToken(registration: PushTokenRegistration): Promise<{ success: boolean; message: string; tokenCount: number }> {
    return this.request('/push/register', {
      method: 'POST',
      body: JSON.stringify(registration),
    });
  }

  // Unregister push notification token
  async unregisterPushToken(token: string): Promise<{ success: boolean; message: string; tokenCount: number }> {
    return this.request('/push/unregister', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // Get push notification status
  async getPushStatus(): Promise<PushStatusResponse> {
    return this.request<PushStatusResponse>('/push/status');
  }
}

// Factory function to create a client from app config
export function createSettingsApiClient(baseUrl: string, apiKey: string): SettingsApiClient {
  return new SettingsApiClient(baseUrl, apiKey);
}

// Factory function to create an extended client with push notification support
export function createExtendedSettingsApiClient(baseUrl: string, apiKey: string): ExtendedSettingsApiClient {
  return new ExtendedSettingsApiClient(baseUrl, apiKey);
}

