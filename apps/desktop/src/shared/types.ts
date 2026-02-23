import type { CHAT_PROVIDER_ID, STT_PROVIDER_ID, TTS_PROVIDER_ID, OPENAI_COMPATIBLE_PRESET_ID } from "."
import type { ToolCall, ToolResult } from '@speakmcp/shared'

export type { ToolCall, ToolResult, BaseChatMessage, ConversationHistoryMessage, ChatApiResponse } from '@speakmcp/shared'

export type RecordingHistoryItem = {
  id: string
  createdAt: number
  duration: number
  transcript: string
}

// Predefined Prompts Types
export interface PredefinedPrompt {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

// MCP Server Configuration Types
export type MCPTransportType = "stdio" | "websocket" | "streamableHttp"

// OAuth 2.1 Configuration Types
export interface OAuthClientMetadata {
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  scope?: string
  token_endpoint_auth_method?: string
}

export interface OAuthTokens {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  expires_at?: number // Calculated expiration timestamp
}

export interface OAuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  jwks_uri?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  code_challenge_methods_supported?: string[]
}

export interface OAuthConfig {
  // Server metadata (discovered or manually configured)
  serverMetadata?: OAuthServerMetadata

  // Client registration info (from dynamic registration or manual config)
  clientId?: string
  clientSecret?: string
  clientMetadata?: OAuthClientMetadata

  // Stored tokens
  tokens?: OAuthTokens

  // Configuration options
  scope?: string
  useDiscovery?: boolean // Whether to use .well-known/oauth-authorization-server
  useDynamicRegistration?: boolean // Whether to use RFC7591 dynamic client registration
  // Optional override for redirect URI (e.g., when the provider disallows custom schemes)
  redirectUri?: string

  // Pending authorization state (used during OAuth flow)
  pendingAuth?: {
    codeVerifier: string
    state: string
  }
}

export interface MCPServerConfig {
  // Transport configuration
  transport?: MCPTransportType // defaults to "stdio" for backward compatibility

  // For stdio transport (local command-based servers)
  command?: string
  args?: string[]
  env?: Record<string, string>

  // For remote transports (websocket/streamableHttp)
  url?: string

  // Custom HTTP headers for streamableHttp transport
  headers?: Record<string, string>

  // OAuth configuration for protected servers
  oauth?: OAuthConfig

  // Common configuration
  timeout?: number
  disabled?: boolean
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

export interface ServerLogEntry {
  timestamp: number
  message: string
}

// Agent Mode Progress Tracking Types

/**
 * A message in a sub-agent conversation
 */
export interface ACPSubAgentMessage {
  /** Role of the sender */
  role: 'user' | 'assistant' | 'tool'
  /** Message content */
  content: string
  /** Tool name if this is a tool call/result */
  toolName?: string
  /** Tool input (for tool calls) */
  toolInput?: unknown
  /** Timestamp */
  timestamp: number
}

/**
 * Progress information for a delegated ACP sub-agent
 */
export interface ACPDelegationProgress {
  /** Unique identifier for this delegation run */
  runId: string
  /** Name of the ACP agent being delegated to */
  agentName: string
  /** The task that was delegated */
  task: string
  /** Current status of the delegation */
  status: 'pending' | 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** Optional progress message from the sub-agent */
  progressMessage?: string
  /** When the delegation started */
  startTime: number
  /** When the delegation ended (if complete) */
  endTime?: number
  /** Result summary (if completed) */
  resultSummary?: string
  /** Error message (if failed) */
  error?: string
  /** Full conversation history from the sub-agent */
  conversation?: ACPSubAgentMessage[]
}

/**
 * State of all active ACP delegations for a session
 */
export interface ACPDelegationState {
  /** Session ID of the parent agent */
  parentSessionId: string
  /** All delegations for this session */
  delegations: ACPDelegationProgress[]
  /** Number of active (non-completed) delegations */
  activeCount: number
}

export interface AgentProgressStep {
  id: string
  type: "thinking" | "tool_call" | "tool_result" | "completion" | "tool_approval"
  title: string
  description?: string
  status: "pending" | "in_progress" | "completed" | "error" | "awaiting_approval"
  timestamp: number
  llmContent?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  approvalRequest?: {
    approvalId: string
    toolName: string
    arguments: any
  }
  /** If this step is a delegation to a sub-agent */
  delegation?: ACPDelegationProgress
  executionStats?: {
    durationMs?: number
    totalTokens?: number
    toolUseCount?: number
    inputTokens?: number
    outputTokens?: number
    cacheHitTokens?: number
  }
  subagentId?: string
}

export interface AgentProgressUpdate {
  sessionId: string
  conversationId?: string
  conversationTitle?: string
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete: boolean
  isSnoozed?: boolean
  finalContent?: string
  /**
   * User-facing response set via respond_to_user tool.
   * On voice interfaces: spoken aloud via TTS
   * On messaging channels (mobile, WhatsApp): sent as a message
   * Consumers should fall back to finalContent if this is not set.
   */
  userResponse?: string
  conversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: ToolCall[]
    toolResults?: ToolResult[]
    timestamp?: number
  }>
  sessionStartIndex?: number
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: any
  }
  retryInfo?: {
    isRetrying: boolean
    attempt: number
    maxAttempts?: number
    delaySeconds: number
    reason: string
    startedAt: number
  }
  streamingContent?: {
    text: string
    isStreaming: boolean
  }
  contextInfo?: {
    estTokens: number
    maxTokens: number
  }
  modelInfo?: {
    provider: string
    model: string
  }
  /** Profile name associated with this session (from profile snapshot) */
  profileName?: string
  acpSessionInfo?: {
    agentName?: string
    agentTitle?: string
    agentVersion?: string
    currentModel?: string
    currentMode?: string
    availableModels?: Array<{ id: string; name: string; description?: string }>
    availableModes?: Array<{ id: string; name: string; description?: string }>
  }
  // Dual-model summarization data
  stepSummaries?: AgentStepSummary[]
  latestSummary?: AgentStepSummary
}

// Dual-Model Agent Mode Configuration
export interface DualModelConfig {
  enabled: boolean

  // Strong model (planning & execution) - uses a preset ID
  // If not set, falls back to the current model preset
  strongModelPresetId?: string
  strongModelName?: string  // Model name within the preset

  // Weak model (summarization) - uses a preset ID
  weakModelPresetId?: string
  weakModelName?: string  // Model name within the preset

  // Summarization settings
  summarizationFrequency?: "every_response" | "major_steps_only"
  summaryDetailLevel?: "compact" | "detailed"
  autoSaveImportantFindings?: boolean
}

// Agent Step Summary (generated by weak model)
export interface AgentStepSummary {
  id: string
  sessionId: string
  stepNumber: number
  timestamp: number

  // Summary content - single line, ultra compact
  actionSummary: string      // What the agent just did (single line)

  /**
   * Durable memory candidates extracted from this step.
   * These should be reusable in future sessions (preferences, constraints, decisions, facts, insights),
   * NOT step-by-step telemetry.
   */
  memoryCandidates?: string[]

  // Metadata
  importance: "low" | "medium" | "high" | "critical"
  savedToMemory?: boolean
  userNotes?: string
  tags?: string[]

  // Legacy fields (kept for backward compatibility)
  keyFindings?: string[]
  nextSteps?: string
  decisionsMade?: string[]
}

// Memory entry (saved from summaries)
export interface AgentMemory {
  id: string
  createdAt: number
  updatedAt: number

  // Agent association - memories can optionally be scoped to a specific agent
  // If undefined, memory is global (default behavior)
  profileId?: string

  // Source info
  sessionId?: string
  conversationId?: string
  conversationTitle?: string

  // Content - single line, ultra compact
  title: string
  content: string             // Single line memory

  // Organization
  tags: string[]
  importance: "low" | "medium" | "high" | "critical"

  // Legacy/optional fields
  keyFindings?: string[]      // Deprecated, kept for backward compatibility
  userNotes?: string
}

// Message Queue Types
export interface QueuedMessage {
  id: string
  conversationId: string
  text: string
  createdAt: number
  status: "pending" | "processing" | "cancelled" | "failed"
  errorMessage?: string
  addedToHistory?: boolean
}

export interface MessageQueue {
  conversationId: string
  messages: QueuedMessage[]
}

// Conversation Types
export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  /**
   * When true, this message is a compaction summary that replaces older messages.
   * Messages before a summary message have been discarded to save context space.
   */
  isSummary?: boolean
  /**
   * Number of messages that were summarized into this summary message.
   * Only set when isSummary is true.
   */
  summarizedMessageCount?: number
}

export interface ConversationMetadata {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessage?: string
  tags?: string[]
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  metadata?: {
    totalTokens?: number
    model?: string
    provider?: string
    agentMode?: boolean
  }
}

export interface ConversationHistoryItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  lastMessage: string
  preview: string
}

export type ProfileMcpServerConfig = {
  disabledServers?: string[]
  disabledTools?: string[]
  // When true, newly-added MCP servers (added after profile creation) are also disabled by default
  // This ensures strict opt-in behavior for profiles created with "all MCPs disabled"
  allServersDisabledByDefault?: boolean
  // When allServersDisabledByDefault is true, this list contains servers that are explicitly ENABLED
  // (i.e., servers the user has opted-in to use for this profile)
  enabledServers?: string[]
  // When set, only these builtin tools are enabled (whitelist approach for agents)
  // If undefined, all builtin tools are available (default behavior)
  enabledBuiltinTools?: string[]
}

export type ProfileModelConfig = {
  // Agent/MCP Tools settings
  mcpToolsProviderId?: "openai" | "groq" | "gemini"
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  currentModelPresetId?: string
  // STT Provider settings
  sttProviderId?: "openai" | "groq" | "parakeet"
  // Transcript Post-Processing settings
  transcriptPostProcessingProviderId?: "openai" | "groq" | "gemini"
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string
  // TTS Provider settings
  ttsProviderId?: "openai" | "groq" | "gemini" | "kitten" | "supertonic"
}

// Per-profile skills configuration
// Skills are disabled by default for each profile; users opt-in to specific skills
export type ProfileSkillsConfig = {
  // List of skill IDs that are enabled for this profile
  enabledSkillIds?: string[]
  // When true, newly-added skills are also disabled by default for this profile
  // This ensures strict opt-in behavior
  allSkillsDisabledByDefault?: boolean
}

// Profile Management Types
export type Profile = {
  id: string
  name: string
  guidelines: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  skillsConfig?: ProfileSkillsConfig
  systemPrompt?: string
}

export type ProfilesData = {
  profiles: Profile[]
  currentProfileId?: string
}

/**
 * Snapshot of profile settings captured at session creation time.
 * This ensures session isolation - changes to the global profile don't affect running sessions.
 */
export type SessionProfileSnapshot = {
  profileId: string
  profileName: string
  guidelines: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  /** Skills instructions to inject into the system prompt (from agent's enabled skills) */
  skillsInstructions?: string
  /** Dynamic agent properties exposed in system prompt (from agent's properties) */
  agentProperties?: Record<string, string>
  skillsConfig?: ProfileSkillsConfig
}

// ============================================================================
// Agent Management Types (legacy Persona types kept for backward compatibility)
// ============================================================================

/**
 * MCP server and tool access configuration for an agent.
 * Controls which MCP servers and tools the agent can access.
 */
export type PersonaMcpServerConfig = {
  /** MCP servers enabled for this agent */
  enabledServers: string[]
  /** Specific tools disabled within enabled servers */
  disabledTools?: string[]
  /** Builtin tools enabled for this agent */
  enabledBuiltinTools?: string[]
}

/**
 * Model configuration for an agent.
 * When using the built-in internal agent, this defines which LLM to use.
 * When using an external ACP agent, model config is handled by that agent.
 *
 * @deprecated Use ProfileModelConfig instead for full preset support.
 * Kept for backward compatibility with existing agent data.
 */
export type PersonaModelConfig = {
  /** LLM provider for this agent */
  providerId: "openai" | "groq" | "gemini"
  /** Model name/identifier */
  model: string
  /** Optional temperature override (0-2) */
  temperature?: number
  /** Optional max tokens override */
  maxTokens?: number
}

/**
 * Skills configuration for an agent.
 * Defines which skills are enabled for this agent.
 */
export type PersonaSkillsConfig = {
  /** Skill IDs enabled for this agent */
  enabledSkillIds: string[]
}

/**
 * Connection configuration for an agent.
 * Defines how to connect to the agent's underlying implementation.
 *
 * Two main modes:
 * 1. Built-in agent (type: "internal") - Uses SpeakMCP's internal agent with agent's model config
 * 2. External ACP agent (type: "acp-agent") - Delegates to a configured ACP agent by name
 */
export type PersonaConnectionConfig = {
  /**
   * Connection type:
   * - "internal": Uses built-in SpeakMCP agent (model config from agent)
   * - "acp-agent": Uses an external ACP agent (model config from agent settings)
   * - "stdio": Direct stdio process (legacy, for advanced use)
   * - "remote": Remote HTTP endpoint (legacy, for advanced use)
   */
  type: "internal" | "acp-agent" | "stdio" | "remote"
  /** For acp-agent: Name of the ACP agent to use */
  acpAgentName?: string
  /** For stdio: command to run */
  command?: string
  /** For stdio: command arguments */
  args?: string[]
  /** For stdio: environment variables */
  env?: Record<string, string>
  /** For stdio: working directory */
  cwd?: string
  /** For remote: base URL of the agent server */
  baseUrl?: string
}

/**
 * Dynamic properties for an agent.
 * Key-value pairs that are exposed in the system prompt.
 * Example: { "expertise": "Python, TypeScript", "style": "Concise and technical" }
 */
export type PersonaProperties = Record<string, string>

/**
 * Legacy Persona definition (kept for backward compatibility / migration).
 * An agent represents a specialized AI assistant with specific capabilities,
 * system prompts, and tool access configurations.
 */
export type Persona = {
  /** Unique identifier for the agent */
  id: string
  /** Internal name (used for referencing) */
  name: string
  /** Human-readable display name */
  displayName: string
  /** Description of what this agent does */
  description: string
  /** System prompt that defines the agent's behavior */
  systemPrompt: string
  /** Additional guidelines for the agent */
  guidelines: string
  /**
   * Dynamic properties for this agent.
   * Exposed in the system prompt as "Property Name: Value" format.
   */
  properties?: PersonaProperties
  /** MCP server and tool access configuration */
  mcpServerConfig: PersonaMcpServerConfig
  /**
   * @deprecated Use profileModelConfig instead for full preset support.
   * Kept for backward compatibility.
   */
  modelConfig?: PersonaModelConfig
  /**
   * Model configuration using the same format as profiles.
   * Only used when connection.type is "internal".
   * When using an external ACP agent, model is configured in agent settings.
   */
  profileModelConfig?: ProfileModelConfig
  /** Skills configuration */
  skillsConfig: PersonaSkillsConfig
  /** Connection configuration for the underlying agent */
  connection: PersonaConnectionConfig
  /** Whether this agent maintains conversation state */
  isStateful: boolean
  /** Current conversation ID for stateful agents */
  conversationId?: string
  /** Whether this agent is enabled */
  enabled: boolean
  /** Whether this is a built-in agent (cannot be deleted) */
  isBuiltIn?: boolean
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Storage format for agents data (legacy format).
 */
export type PersonasData = {
  /** List of all agents */
  personas: Persona[]
}

// ============================================================================
// Unified Agent Profile Type
// Consolidates legacy Profile, Persona, and ACPAgentConfig into a single Agent type
// ============================================================================

/**
 * Connection type for an agent profile.
 * - "internal": Uses built-in SpeakMCP agent (model config from profile)
 * - "acp": External ACP-compatible agent (stdio spawn)
 * - "stdio": Direct stdio process spawn
 * - "remote": Remote HTTP endpoint
 */
export type AgentProfileConnectionType = "internal" | "acp" | "stdio" | "remote"

/**
 * Connection configuration for an agent profile.
 */
export type AgentProfileConnection = {
  type: AgentProfileConnectionType
  /** For acp/stdio: command to run */
  command?: string
  /** For acp/stdio: command arguments */
  args?: string[]
  /** For acp/stdio: environment variables */
  env?: Record<string, string>
  /** For acp/stdio: working directory */
  cwd?: string
  /** For remote: base URL of the agent server */
  baseUrl?: string
}

/**
 * Tool access configuration for an agent profile.
 * Controls which MCP servers and tools the agent can access.
 */
export type AgentProfileToolConfig = {
  /** MCP servers enabled for this agent (whitelist) */
  enabledServers?: string[]
  /** MCP servers disabled for this agent (blacklist) */
  disabledServers?: string[]
  /** Specific tools disabled */
  disabledTools?: string[]
  /** Builtin tools enabled (whitelist) - if undefined, all are available */
  enabledBuiltinTools?: string[]
  /** When true, newly-added servers are disabled by default */
  allServersDisabledByDefault?: boolean
}

/**
 * Unified Agent Profile.
 *
 * Can represent:
 * - User-facing profiles (isUserProfile: true) - shows in profile picker
 * - Delegation targets (isAgentTarget: true) - available for delegate_to_agent
 * - External ACP agents (connection.type: "acp" or "stdio")
 * - Internal sub-sessions (connection.type: "internal")
 */

/**
 * Role classification for an agent profile.
 * - "user-profile": User-facing profile shown in profile picker
 * - "delegation-target": Available as a target for delegate_to_agent
 * - "external-agent": External ACP/stdio agent
 */
export type AgentProfileRole = "user-profile" | "delegation-target" | "external-agent"

export type AgentProfile = {
  /** Unique identifier */
  id: string
  /** Internal name for referencing (slug-style) */
  name: string
  /** Human-readable display name */
  displayName: string
  /** Description of what this agent does */
  description?: string
  /** Custom avatar as a base64 data URL. If absent, a deterministic face is generated. */
  avatarDataUrl?: string | null

  // Behavior
  /** System prompt that defines the agent's behavior */
  systemPrompt?: string
  /** Additional guidelines for the agent */
  guidelines?: string
  /** Dynamic properties exposed in system prompt */
  properties?: Record<string, string>

  // Model Configuration (only for internal execution)
  /** Model configuration - uses ProfileModelConfig format */
  modelConfig?: ProfileModelConfig

  // Tool Access
  /** Tool and MCP server access configuration */
  toolConfig?: AgentProfileToolConfig

  // Skills
  /** Skills configuration */
  skillsConfig?: ProfileSkillsConfig

  // Connection - how to run this agent
  /** Connection configuration for the underlying agent */
  connection: AgentProfileConnection

  // State
  /** Whether this agent maintains conversation state */
  isStateful?: boolean
  /** Current conversation ID for stateful agents */
  conversationId?: string

  // Role Classification
  /** Role classification for this agent profile */
  role?: AgentProfileRole

  // Flags
  /** Whether this agent is enabled */
  enabled: boolean
  /** Whether this is a built-in agent (cannot be deleted) */
  isBuiltIn?: boolean
  /** Whether this appears in the user profile picker (legacy, use role instead) */
  isUserProfile?: boolean
  /** Whether this is available as a delegation target (legacy, use role instead) */
  isAgentTarget?: boolean
  /** Whether this is the default profile */
  isDefault?: boolean
  /** Whether to auto-spawn this agent on app startup (for ACP agents) */
  autoSpawn?: boolean

  // Timestamps
  createdAt: number
  updatedAt: number
}

/**
 * Storage format for agent profiles.
 */
export type AgentProfilesData = {
  profiles: AgentProfile[]
  currentProfileId?: string
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Convert a legacy Profile to AgentProfile.
 */
export function profileToAgentProfile(profile: Profile): AgentProfile {
  return {
    id: profile.id,
    name: profile.name,
    displayName: profile.name,
    description: undefined,
    systemPrompt: profile.systemPrompt,
    guidelines: profile.guidelines,
    properties: undefined,
    modelConfig: profile.modelConfig,
    toolConfig: profile.mcpServerConfig ? {
      disabledServers: profile.mcpServerConfig.disabledServers,
      disabledTools: profile.mcpServerConfig.disabledTools,
      allServersDisabledByDefault: profile.mcpServerConfig.allServersDisabledByDefault,
      enabledServers: profile.mcpServerConfig.enabledServers,
      enabledBuiltinTools: profile.mcpServerConfig.enabledBuiltinTools,
    } : undefined,
    skillsConfig: profile.skillsConfig,
    connection: { type: "internal" },
    isStateful: false,
    role: "user-profile",
    enabled: true,
    isBuiltIn: false,
    isUserProfile: true,
    isAgentTarget: false,
    isDefault: profile.isDefault,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

/**
 * Convert a legacy Persona to AgentProfile (for migration).
 */
export function personaToAgentProfile(persona: Persona): AgentProfile {
  // Map legacy connection type to AgentProfile connection type
  const connectionType: AgentProfileConnectionType =
    persona.connection.type === "acp-agent" ? "acp" : persona.connection.type

  return {
    id: persona.id,
    name: persona.name,
    displayName: persona.displayName,
    description: persona.description,
    systemPrompt: persona.systemPrompt,
    guidelines: persona.guidelines,
    properties: persona.properties,
    modelConfig: persona.profileModelConfig,
    toolConfig: {
      enabledServers: persona.mcpServerConfig.enabledServers,
      disabledTools: persona.mcpServerConfig.disabledTools,
      enabledBuiltinTools: persona.mcpServerConfig.enabledBuiltinTools,
    },
    skillsConfig: { enabledSkillIds: persona.skillsConfig.enabledSkillIds },
    connection: {
      type: connectionType,
      command: persona.connection.command,
      args: persona.connection.args,
      env: persona.connection.env,
      cwd: persona.connection.cwd,
      baseUrl: persona.connection.baseUrl,
    },
    isStateful: persona.isStateful,
    conversationId: persona.conversationId,
    role: "delegation-target",
    enabled: persona.enabled,
    isBuiltIn: persona.isBuiltIn,
    isUserProfile: false,
    isAgentTarget: true,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
  }
}

/**
 * Convert a legacy ACPAgentConfig to AgentProfile.
 */
export function acpAgentConfigToAgentProfile(config: ACPAgentConfig): AgentProfile {
  const now = Date.now()
  const connectionType: AgentProfileConnectionType =
    config.connection.type === "internal" ? "internal" :
    config.connection.type === "remote" ? "remote" : "acp"

  return {
    id: config.name,
    name: config.name,
    displayName: config.displayName,
    description: config.description,
    connection: {
      type: connectionType,
      command: config.connection.command,
      args: config.connection.args,
      env: config.connection.env,
      cwd: config.connection.cwd,
      baseUrl: config.connection.baseUrl,
    },
    role: "external-agent",
    enabled: config.enabled ?? true,
    isBuiltIn: config.isInternal,
    isUserProfile: false,
    isAgentTarget: true,
    autoSpawn: config.autoSpawn,
    createdAt: now,
    updatedAt: now,
  }
}

export interface ModelPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  isBuiltIn?: boolean
  createdAt?: number
  updatedAt?: number
  mcpToolsModel?: string
  transcriptProcessingModel?: string
  summarizationModel?: string  // Model for dual-model summarization (weak model)
}

// ============================================================================
// Model Information Types
// ============================================================================

/**
 * Basic model information returned from provider APIs (OpenAI, Groq, Gemini).
 * This is the minimal structure for displaying and selecting models.
 */
export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  created?: number
  /** Whether this model supports speech-to-text transcription */
  supportsTranscription?: boolean
}

// ============================================================================
// Models.dev API Types
// Types for enhanced model information from https://models.dev API
// ============================================================================

/**
 * Cost information for a model (USD per million tokens).
 */
export interface ModelsDevCost {
  /** Cost per million input tokens */
  input: number
  /** Cost per million output tokens */
  output: number
  /** Cost per million reasoning tokens (optional) */
  reasoning?: number
  /** Cost per million cache read tokens (optional) */
  cache_read?: number
  /** Cost per million cache write tokens (optional) */
  cache_write?: number
}

/**
 * Token limits for a model.
 */
export interface ModelsDevLimit {
  /** Maximum context window size (tokens) */
  context: number
  /** Maximum output tokens */
  output: number
  /** Maximum input tokens (optional, usually same as context) */
  input?: number
}

/**
 * Input/output modalities supported by a model.
 */
export interface ModelsDevModalities {
  /** Input modalities (e.g., ["text", "image", "audio"]) */
  input: string[]
  /** Output modalities (e.g., ["text", "image"]) */
  output: string[]
}

/**
 * Model information from models.dev API.
 * Contains detailed metadata about model capabilities and pricing.
 */
export interface ModelsDevModel {
  /** Model identifier (e.g., "gpt-4o", "claude-3-opus") */
  id: string
  /** Human-readable model name */
  name: string
  /** Model family (optional, e.g., "GPT-4", "Claude 3") */
  family?: string

  // Capability flags
  /** Whether the model supports file/image attachments */
  attachment: boolean
  /** Whether the model supports reasoning/chain-of-thought */
  reasoning: boolean
  /** Whether the model supports tool/function calling */
  tool_call: boolean
  /** Whether the model supports structured output (JSON mode) */
  structured_output: boolean
  /** Whether the model supports temperature parameter */
  temperature: boolean

  // Metadata
  /** Knowledge cutoff date (optional) */
  knowledge?: string
  /** Release date (optional) */
  release_date?: string
  /** Last updated date (optional) */
  last_updated?: string
  /** Whether model weights are publicly available */
  open_weights: boolean

  /** Pricing information (USD per million tokens) */
  cost: ModelsDevCost
  /** Token limits */
  limit: ModelsDevLimit
  /** Supported input/output modalities */
  modalities: ModelsDevModalities
}

/**
 * Provider information from models.dev API.
 * Contains metadata about an LLM provider and its available models.
 */
export interface ModelsDevProvider {
  /** Provider identifier (e.g., "openai", "anthropic") */
  id: string
  /** Human-readable provider name */
  name: string
  /** NPM package name for the provider SDK */
  npm: string
  /** API endpoint (optional) */
  api?: string
  /** Environment variable for API key */
  env: string
  /** Documentation URL */
  doc: string
  /** Available models from this provider */
  models: Record<string, ModelsDevModel>
}

/**
 * Complete models.dev data structure.
 * Maps provider IDs to their provider information and models.
 */
export type ModelsDevData = Record<string, ModelsDevProvider>

/**
 * Enhanced model information combining basic ModelInfo with models.dev data.
 * Used when we have additional metadata from the models.dev API.
 * Backward compatible - all enhanced fields are optional.
 */
export interface EnhancedModelInfo extends ModelInfo {
  /** Model family (e.g., "GPT-4", "Claude 3") */
  family?: string

  // Capability flags from models.dev
  /** Whether the model supports file/image attachments */
  supportsAttachment?: boolean
  /** Whether the model supports reasoning/chain-of-thought */
  supportsReasoning?: boolean
  /** Whether the model supports tool/function calling */
  supportsToolCalls?: boolean
  /** Whether the model supports structured output (JSON mode) */
  supportsStructuredOutput?: boolean
  /** Whether the model supports temperature parameter */
  supportsTemperature?: boolean

  // Metadata from models.dev
  /** Knowledge cutoff date */
  knowledge?: string
  /** Release date */
  releaseDate?: string
  /** Last updated date */
  lastUpdated?: string
  /** Whether model weights are publicly available */
  openWeights?: boolean

  // Pricing (USD per million tokens)
  /** Cost per million input tokens */
  inputCost?: number
  /** Cost per million output tokens */
  outputCost?: number
  /** Cost per million reasoning tokens */
  reasoningCost?: number
  /** Cost per million cache read tokens */
  cacheReadCost?: number
  /** Cost per million cache write tokens */
  cacheWriteCost?: number

  // Limits
  /** Maximum context window size (tokens) */
  contextLimit?: number
  /** Maximum input tokens */
  inputLimit?: number
  /** Maximum output tokens */
  outputLimit?: number

  // Modalities
  /** Input modalities (e.g., ["text", "image", "audio"]) */
  inputModalities?: string[]
  /** Output modalities (e.g., ["text", "image"]) */
  outputModalities?: string[]
}

// ACP Agent Configuration Types
export type ACPConnectionType = "stdio" | "remote" | "internal"

export interface ACPAgentConfig {
  // Unique identifier for the agent
  name: string
  // Human-readable display name
  displayName: string
  // Description of what the agent does
  description?: string
  // Whether to auto-spawn this agent on app startup
  autoSpawn?: boolean
  // Whether this agent is enabled
  enabled?: boolean
  // Whether this is a built-in internal agent (cannot be deleted)
  isInternal?: boolean
  // Connection configuration
  connection: {
    // Connection type: "stdio" for local process, "remote" for HTTP endpoint, "internal" for built-in
    type: ACPConnectionType
    // For stdio: command to run (e.g., "auggie", "claude-code-acp")
    command?: string
    // For stdio: command arguments (e.g., ["--acp"])
    args?: string[]
    // For stdio: environment variables
    env?: Record<string, string>
    // For stdio: working directory to spawn the agent in
    cwd?: string
    // For remote: base URL of the ACP server
    baseUrl?: string
  }
}

// Agent Skills Types
// Skills are instruction files that can be loaded dynamically to improve AI performance on specialized tasks
// Based on Anthropic's Agent Skills specification (formerly Claude Skills)
export interface AgentSkill {
  id: string
  name: string
  description: string
  instructions: string // The markdown content with instructions
  enabled: boolean
  createdAt: number
  updatedAt: number
  source?: "local" | "imported" // Where the skill came from
  filePath?: string // Path to the SKILL.md file if loaded from disk
}

export interface AgentSkillsData {
  skills: AgentSkill[]
}

export interface LoopConfig {
  id: string               // unique identifier (uuid)
  name: string             // display name
  prompt: string           // the prompt text sent to the agent
  intervalMinutes: number  // how often to run (in minutes)
  enabled: boolean         // whether this loop is active
  profileId?: string       // optional profile to use for the agent session
  lastRunAt?: number       // timestamp (ms) of last execution
  runOnStartup?: boolean   // if true, fires immediately on app start before first interval
}

export type Config = {
  shortcut?: "hold-ctrl" | "ctrl-slash" | "custom"
  customShortcut?: string
  customShortcutMode?: "hold" | "toggle" // Mode for custom recording shortcut
  hideDockIcon?: boolean
  launchAtLogin?: boolean

  // Onboarding Configuration
  onboardingCompleted?: boolean

  // Toggle Voice Dictation Configuration
  toggleVoiceDictationEnabled?: boolean
  toggleVoiceDictationHotkey?: "fn" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "custom"
  customToggleVoiceDictationHotkey?: string

  // Theme Configuration
  themePreference?: "system" | "light" | "dark"

  sttProviderId?: STT_PROVIDER_ID

  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiCompatiblePreset?: OPENAI_COMPATIBLE_PRESET_ID

  modelPresets?: ModelPreset[]
  currentModelPresetId?: string

  groqApiKey?: string
  groqBaseUrl?: string
  groqSttPrompt?: string

  geminiApiKey?: string
  geminiBaseUrl?: string

  // Speech-to-Text Language Configuration
  sttLanguage?: string
  openaiSttLanguage?: string
  groqSttLanguage?: string

  // Transcription Preview - show live transcription while recording
  transcriptionPreviewEnabled?: boolean

  // Parakeet (Local) STT Configuration
  parakeetModelPath?: string // Optional custom model path
  parakeetNumThreads?: number // Number of threads (default: 2)
  parakeetModelDownloaded?: boolean // Whether model has been downloaded

  // Text-to-Speech Configuration
  ttsEnabled?: boolean
  ttsAutoPlay?: boolean
  ttsProviderId?: TTS_PROVIDER_ID

  // OpenAI TTS Configuration
  openaiTtsModel?: "tts-1" | "tts-1-hd"
  openaiTtsVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
  openaiTtsSpeed?: number // 0.25 to 4.0
  openaiTtsResponseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"

  // Groq TTS Configuration
  groqTtsModel?: "canopylabs/orpheus-v1-english" | "canopylabs/orpheus-arabic-saudi"
  groqTtsVoice?: string

  // Gemini TTS Configuration
  geminiTtsModel?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts"
  geminiTtsVoice?: string
  geminiTtsLanguage?: string

  // Kitten (Local) TTS Configuration
  kittenModelDownloaded?: boolean // Whether model has been downloaded
  kittenVoiceId?: number // Voice ID 0-7 (default: 0 for Voice 2 - Male)

  // Supertonic (Local) TTS Configuration
  supertonicModelDownloaded?: boolean // Whether model has been downloaded
  supertonicVoice?: string // Voice style ID (e.g., "M1", "F1") - default "M1"
  supertonicLanguage?: string // Language code (en, ko, es, pt, fr) - default "en"
  supertonicSpeed?: number // Speech speed (default: 1.05)
  supertonicSteps?: number // Denoising steps (default: 5, higher = better quality)

  // TTS Text Preprocessing Configuration
  ttsPreprocessingEnabled?: boolean
  ttsRemoveCodeBlocks?: boolean
  ttsRemoveUrls?: boolean
  ttsConvertMarkdown?: boolean
  // LLM-based TTS Preprocessing (for more natural speech output)
  ttsUseLLMPreprocessing?: boolean
  ttsLLMPreprocessingProviderId?: CHAT_PROVIDER_ID

  transcriptPostProcessingEnabled?: boolean
  transcriptPostProcessingProviderId?: CHAT_PROVIDER_ID
  transcriptPostProcessingPrompt?: string
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string

  // Text Input Configuration
  textInputEnabled?: boolean
  textInputShortcut?: "ctrl-t" | "ctrl-shift-t" | "alt-t" | "custom"
  customTextInputShortcut?: string

  // Settings Window Hotkey Configuration
  settingsHotkeyEnabled?: boolean
  settingsHotkey?: "ctrl-shift-s" | "ctrl-comma" | "ctrl-shift-comma" | "custom"
  customSettingsHotkey?: string

  // Agent Kill Switch Configuration
  agentKillSwitchEnabled?: boolean
  agentKillSwitchHotkey?:
    | "ctrl-shift-escape"
    | "ctrl-alt-q"
    | "ctrl-shift-q"
    | "custom"
  customAgentKillSwitchHotkey?: string

  // MCP Tool Calling Configuration
  /** @deprecated MCP tools are now always enabled. This field is kept for backwards compatibility but ignored. */
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: "hold-ctrl-alt" | "toggle-ctrl-alt" | "ctrl-alt-slash" | "custom"
  customMcpToolsShortcut?: string
  customMcpToolsShortcutMode?: "hold" | "toggle" // Mode for custom MCP tools shortcut
  mcpToolsProviderId?: CHAT_PROVIDER_ID
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpToolsSystemPrompt?: string
  mcpCustomSystemPrompt?: string
  mcpCurrentProfileId?: string
  /** @deprecated Agent mode is now always enabled. This field is kept for backwards compatibility but ignored. */
  mcpAgentModeEnabled?: boolean
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpMaxIterations?: number
  mcpUnlimitedIterations?: boolean

  // MCP Server Configuration
  mcpConfig?: MCPConfig

  mcpRuntimeDisabledServers?: string[]

  mcpDisabledTools?: string[]

  // UI State Persistence - Collapsed/Expanded sections in Settings
  mcpToolsCollapsedServers?: string[]  // Server names that are collapsed in the Tools section
  mcpServersCollapsedServers?: string[]  // Server names that are collapsed in the Servers section

  // Conversation Configuration
  conversationsEnabled?: boolean
  maxConversationsToKeep?: number
  autoSaveConversations?: boolean

  // Provider Section Collapse Configuration
  providerSectionCollapsedOpenai?: boolean
  providerSectionCollapsedGroq?: boolean
  providerSectionCollapsedGemini?: boolean
  providerSectionCollapsedParakeet?: boolean
  providerSectionCollapsedKitten?: boolean
  providerSectionCollapsedSupertonic?: boolean

  // Panel Position Configuration
  panelPosition?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right"
    | "custom"
  panelCustomPosition?: { x: number; y: number }
  panelDragEnabled?: boolean
  panelCustomSize?: { width: number; height: number }
  panelProgressSize?: { width: number; height: number }

  // Floating Panel Auto-Show Configuration
  // When false, the floating panel will not automatically appear during agent sessions
  // Users can still manually access the panel via hotkeys, tray menu, or UI
  floatingPanelAutoShow?: boolean

  // Hide Floating Panel When Main App is Focused
  // When true (default), the floating panel will automatically hide when the main SpeakMCP window is focused
  // The panel will reappear when the main window loses focus (if auto-show conditions are met)
  hidePanelWhenMainFocused?: boolean

  // API Retry Configuration
  apiRetryCount?: number
  apiRetryBaseDelay?: number
  apiRetryMaxDelay?: number

  // Context Reduction Configuration
  mcpContextReductionEnabled?: boolean
  mcpContextTargetRatio?: number
  mcpContextLastNMessages?: number
  mcpContextSummarizeCharThreshold?: number
  mcpMaxContextTokensOverride?: number

  // Tool Response Processing Configuration
  mcpToolResponseProcessingEnabled?: boolean
  mcpToolResponseLargeThreshold?: number
  mcpToolResponseCriticalThreshold?: number
  mcpToolResponseChunkSize?: number
  mcpToolResponseProgressUpdates?: boolean

  // Completion Verification Configuration
  mcpVerifyCompletionEnabled?: boolean
  mcpVerifyContextMaxItems?: number
  mcpVerifyRetryCount?: number

  // Final Summary Configuration
  mcpFinalSummaryEnabled?: boolean

  // Parallel Tool Execution Configuration
  mcpParallelToolExecution?: boolean

  // Message Queue Configuration - when enabled, users can queue messages while agent is processing
  mcpMessageQueueEnabled?: boolean

  // Predefined Prompts - frequently used prompts that can be quickly accessed
  predefinedPrompts?: PredefinedPrompt[]

	  // Remote Server Configuration
	  remoteServerEnabled?: boolean
	  remoteServerPort?: number
	  remoteServerBindAddress?: "127.0.0.1" | "0.0.0.0"
	  remoteServerApiKey?: string
	  remoteServerLogLevel?: "error" | "info" | "debug"
	  remoteServerCorsOrigins?: string[]
	  remoteServerAutoShowPanel?: boolean // Auto-show floating panel when receiving remote messages
	  remoteServerTerminalQrEnabled?: boolean // Print QR code to terminal for mobile app pairing (auto-enabled in headless mode)

  // Cloudflare Tunnel Configuration
  // Tunnel mode: "quick" for random URLs (no account required), "named" for persistent URLs (requires account)
  cloudflareTunnelMode?: "quick" | "named"
  // Auto-start tunnel on app startup (requires remote server to be enabled)
  cloudflareTunnelAutoStart?: boolean
  // Named tunnel configuration (for persistent URLs)
  cloudflareTunnelId?: string // The tunnel UUID (e.g., "abc123-def456-...")
  cloudflareTunnelName?: string // Human-readable tunnel name
  cloudflareTunnelCredentialsPath?: string // Path to credentials JSON file (defaults to ~/.cloudflared/<tunnel-id>.json)
  cloudflareTunnelHostname?: string // Custom hostname for the tunnel (e.g., "myapp.example.com")

  // WhatsApp Integration Configuration
  whatsappEnabled?: boolean
  whatsappAllowFrom?: string[]  // Phone numbers allowed to message (international format without +)
  whatsappAutoReply?: boolean   // Auto-reply to messages using agent
  whatsappLogMessages?: boolean // Log message content (privacy concern)

  // Stream Status Watcher Configuration
  streamStatusWatcherEnabled?: boolean
  streamStatusFilePath?: string

  // ACP Agent Configuration
  acpAgents?: ACPAgentConfig[]

  // Unified Agent Profiles (managed by agent-profile-service)
  agentProfiles?: AgentProfile[]

  // Main agent mode: "api" uses external LLM API, "acp" uses an ACP agent as the brain
  mainAgentMode?: "api" | "acp"

  // Name of the ACP agent to use when mainAgentMode is "acp"
  mainAgentName?: string

  // ACP Tool Injection: When true (default), SpeakMCP's builtin tools are injected
  // into ACP agent sessions so they can use delegation, settings management, etc.
  // Set to false for "pure" ACP mode where the agent only uses its own tools.
  acpInjectBuiltinTools?: boolean

  // Streamer Mode Configuration
  // When enabled, hides sensitive information (phone numbers, QR codes, API keys) for screen sharing
  streamerModeEnabled?: boolean

  // Push Notification Configuration for Mobile App
  // Stores registered push notification tokens from mobile clients
  pushNotificationTokens?: PushNotificationToken[]

  // Langfuse Observability Configuration
  // When enabled, traces all LLM calls, agent sessions, and MCP tool calls
  langfuseEnabled?: boolean
  langfusePublicKey?: string
  langfuseSecretKey?: string
  langfuseBaseUrl?: string // Default: https://cloud.langfuse.com (or custom self-hosted URL)

  // Dual-Model Agent Mode Configuration
  dualModelEnabled?: boolean
  dualModelStrongPresetId?: string  // Preset ID for strong model
  dualModelStrongModelName?: string  // Model name within the preset
  dualModelWeakPresetId?: string  // Preset ID for weak model
  dualModelWeakModelName?: string  // Model name within the preset
  dualModelSummarizationFrequency?: "every_response" | "major_steps_only"
  dualModelSummaryDetailLevel?: "compact" | "detailed"
  dualModelAutoSaveImportant?: boolean
  dualModelInjectMemories?: boolean  // Whether to inject memories into system prompt (default: false)
  dualModelSectionCollapsed?: boolean  // UI state for settings section

  // Memory System Configuration
  memoriesEnabled?: boolean  // When false, disables all memory features (save_memory tool, injection, auto-save, UI)

  // Agent Loops Configuration
  loops?: LoopConfig[]  // Scheduled agent loops that run at intervals
}

// Push Notification Token (from mobile clients)
export interface PushNotificationToken {
  token: string
  type: 'expo'
  platform: 'ios' | 'android'
  registeredAt: number
  deviceId?: string
  badgeCount?: number // Tracks unread notification count for this device
}


// MCP Elicitation Types (Protocol 2025-11-25)
export interface ElicitationFormField {
  type: "string" | "number" | "boolean" | "enum"
  title?: string
  description?: string
  default?: string | number | boolean
  // String-specific
  minLength?: number
  maxLength?: number
  format?: "email" | "uri" | "date" | "date-time"
  // Number-specific
  minimum?: number
  maximum?: number
  // Enum-specific
  enum?: string[]
  enumNames?: string[]
}

export interface ElicitationFormSchema {
  type: "object"
  properties: Record<string, ElicitationFormField>
  required?: string[]
}

export interface ElicitationFormRequest {
  mode: "form"
  serverName: string
  message: string
  requestedSchema: ElicitationFormSchema
  requestId: string
}

export interface ElicitationUrlRequest {
  mode: "url"
  serverName: string
  message: string
  url: string
  elicitationId: string
  requestId: string
}

export type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest

export interface ElicitationResult {
  action: "accept" | "decline" | "cancel"
  content?: Record<string, string | number | boolean | string[]>
}

// MCP Sampling Types (Protocol 2025-11-25)
export interface SamplingMessageContent {
  type: "text" | "image" | "audio"
  text?: string
  data?: string
  mimeType?: string
}

export interface SamplingMessage {
  role: "user" | "assistant"
  content: SamplingMessageContent | SamplingMessageContent[]
}

export interface SamplingRequest {
  serverName: string
  requestId: string
  messages: SamplingMessage[]
  systemPrompt?: string
  maxTokens: number
  temperature?: number
  modelPreferences?: {
    hints?: Array<{ name?: string }>
    costPriority?: number
    speedPriority?: number
    intelligencePriority?: number
  }
}

export interface SamplingResult {
  approved: boolean
  model?: string
  content?: SamplingMessageContent
  stopReason?: string
}
