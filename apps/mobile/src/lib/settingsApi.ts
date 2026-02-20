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
  // MCP Tools Model Configuration
  mcpToolsProviderId: 'openai' | 'groq' | 'gemini';
  mcpToolsOpenaiModel?: string;
  mcpToolsGroqModel?: string;
  mcpToolsGeminiModel?: string;
  currentModelPresetId?: string;
  availablePresets?: ModelPreset[];

  // Agent Execution Settings
  mcpRequireApprovalBeforeToolCall?: boolean;
  mcpMaxIterations?: number;
  mcpUnlimitedIterations?: boolean;
  mainAgentMode?: 'api' | 'acp';
  mainAgentName?: string;
  acpInjectBuiltinTools?: boolean;
  mcpVerifyCompletionEnabled?: boolean;
  mcpFinalSummaryEnabled?: boolean;

  // Context Reduction & Tool Response Processing
  mcpContextReductionEnabled?: boolean;
  mcpToolResponseProcessingEnabled?: boolean;
  mcpParallelToolExecution?: boolean;
  mcpMessageQueueEnabled?: boolean;

  // Speech-to-Text Configuration
  sttProviderId?: 'openai' | 'groq' | 'parakeet';
  sttLanguage?: string;
  transcriptionPreviewEnabled?: boolean;

  // Transcript Post-Processing
  transcriptPostProcessingEnabled?: boolean;
  transcriptPostProcessingProviderId?: 'openai' | 'groq' | 'gemini';
  transcriptPostProcessingOpenaiModel?: string;
  transcriptPostProcessingGroqModel?: string;
  transcriptPostProcessingGeminiModel?: string;
  transcriptPostProcessingPrompt?: string;

  // Text-to-Speech Configuration
  ttsEnabled?: boolean;
  ttsAutoPlay?: boolean;
  ttsProviderId?: 'openai' | 'groq' | 'gemini' | 'kitten' | 'supertonic';
  ttsPreprocessingEnabled?: boolean;
  ttsRemoveCodeBlocks?: boolean;
  ttsRemoveUrls?: boolean;
  ttsConvertMarkdown?: boolean;
  ttsUseLLMPreprocessing?: boolean;

  // WhatsApp Integration
  whatsappEnabled?: boolean;
  whatsappAllowFrom?: string[];
  whatsappAutoReply?: boolean;
  whatsappLogMessages?: boolean;

  // Langfuse Observability
  langfuseEnabled?: boolean;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;

  // Dual-Model & Memory Settings
  dualModelEnabled?: boolean;
  dualModelInjectMemories?: boolean;
  dualModelAutoSaveImportant?: boolean;
  memoriesEnabled?: boolean;

  // Streamer Mode
  streamerModeEnabled?: boolean;
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
  // MCP Tools Model Configuration
  mcpToolsProviderId?: 'openai' | 'groq' | 'gemini';
  mcpToolsOpenaiModel?: string;
  mcpToolsGroqModel?: string;
  mcpToolsGeminiModel?: string;
  currentModelPresetId?: string;

  // Agent Execution Settings
  mcpRequireApprovalBeforeToolCall?: boolean;
  mcpMaxIterations?: number;
  mcpUnlimitedIterations?: boolean;
  mainAgentMode?: 'api' | 'acp';
  mainAgentName?: string;
  acpInjectBuiltinTools?: boolean;
  mcpVerifyCompletionEnabled?: boolean;
  mcpFinalSummaryEnabled?: boolean;

  // Context Reduction & Tool Response Processing
  mcpContextReductionEnabled?: boolean;
  mcpToolResponseProcessingEnabled?: boolean;
  mcpParallelToolExecution?: boolean;
  mcpMessageQueueEnabled?: boolean;

  // Speech-to-Text Configuration
  sttProviderId?: 'openai' | 'groq' | 'parakeet';
  sttLanguage?: string;
  transcriptionPreviewEnabled?: boolean;

  // Transcript Post-Processing
  transcriptPostProcessingEnabled?: boolean;
  transcriptPostProcessingProviderId?: 'openai' | 'groq' | 'gemini';
  transcriptPostProcessingOpenaiModel?: string;
  transcriptPostProcessingGroqModel?: string;
  transcriptPostProcessingGeminiModel?: string;
  transcriptPostProcessingPrompt?: string;

  // Text-to-Speech Configuration
  ttsEnabled?: boolean;
  ttsAutoPlay?: boolean;
  ttsProviderId?: 'openai' | 'groq' | 'gemini' | 'kitten' | 'supertonic';
  ttsPreprocessingEnabled?: boolean;
  ttsRemoveCodeBlocks?: boolean;
  ttsRemoveUrls?: boolean;
  ttsConvertMarkdown?: boolean;
  ttsUseLLMPreprocessing?: boolean;

  // WhatsApp Integration
  whatsappEnabled?: boolean;
  whatsappAllowFrom?: string[];
  whatsappAutoReply?: boolean;
  whatsappLogMessages?: boolean;

  // Langfuse Observability
  langfuseEnabled?: boolean;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;

  // Dual-Model & Memory Settings
  dualModelEnabled?: boolean;
  dualModelInjectMemories?: boolean;
  dualModelAutoSaveImportant?: boolean;
  memoriesEnabled?: boolean;

  // Streamer Mode
  streamerModeEnabled?: boolean;
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

// Skills Types
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  enabledForProfile: boolean;
  source?: 'local' | 'imported';
  createdAt: number;
  updatedAt: number;
}

export interface SkillsResponse {
  skills: Skill[];
  currentProfileId?: string;
}

// Memories Types
export interface Memory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  importance: 'low' | 'medium' | 'high' | 'critical';
  profileId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoriesResponse {
  memories: Memory[];
}

// Agent Profiles (Personas) Types
export interface AgentProfile {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  isBuiltIn?: boolean;
  isUserProfile?: boolean;
  isAgentTarget?: boolean;
  role?: 'user-profile' | 'delegation-target' | 'external-agent';
  connectionType: 'internal' | 'acp' | 'stdio' | 'remote';
  autoSpawn?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProfilesResponse {
  profiles: AgentProfile[];
}

// Agent Loops Types
export interface Loop {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  profileId?: string;
  profileName?: string;
  runOnStartup?: boolean;
  lastRunAt?: number;
  isRunning: boolean;
  nextRunAt?: number;
}

export interface LoopsResponse {
  loops: Loop[];
}

// Extended client with push notification methods
export class ExtendedSettingsApiClient extends SettingsApiClient {
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

  // ============================================
  // Skills Management
  // ============================================

  async getSkills(): Promise<SkillsResponse> {
    return this.request<SkillsResponse>('/v1/skills');
  }

  async toggleSkillForProfile(skillId: string): Promise<{ success: boolean; skillId: string; enabledForProfile: boolean }> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}/toggle-profile`, {
      method: 'POST',
    });
  }

  // ============================================
  // Memories Management
  // ============================================

  async getMemories(profileId?: string): Promise<MemoriesResponse> {
    const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
    return this.request<MemoriesResponse>(`/v1/memories${query}`);
  }

  async deleteMemory(id: string): Promise<{ success: boolean; id: string }> {
    return this.request(`/v1/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Agent Profiles (Personas) Management
  // ============================================

  async getAgentProfiles(): Promise<AgentProfilesResponse> {
    return this.request<AgentProfilesResponse>('/v1/agent-profiles');
  }

  async toggleAgentProfile(id: string): Promise<{ success: boolean; id: string; enabled: boolean }> {
    return this.request(`/v1/agent-profiles/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    });
  }

  // ============================================
  // Agent Loops Management
  // ============================================

  async getLoops(): Promise<LoopsResponse> {
    return this.request<LoopsResponse>('/v1/loops');
  }

  async toggleLoop(id: string): Promise<{ success: boolean; id: string; enabled: boolean }> {
    return this.request(`/v1/loops/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    });
  }

  async runLoop(id: string): Promise<{ success: boolean; id: string }> {
    return this.request(`/v1/loops/${encodeURIComponent(id)}/run`, {
      method: 'POST',
    });
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

