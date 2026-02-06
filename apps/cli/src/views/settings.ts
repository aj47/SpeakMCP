/**
 * Settings View - Interactive configuration form
 */

import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
} from '@opentui/core'

import { BaseView } from './base'
import type { Settings, McpServer, ModelPreset } from '../types'

// Provider options
const PROVIDERS = [
  { name: 'OpenAI', id: 'openai' },
  { name: 'Groq', id: 'groq' },
  { name: 'Gemini', id: 'gemini' },
]

// Toggle key type for all boolean settings
type ToggleKey =
  | 'ttsEnabled' | 'mcpRequireApprovalBeforeToolCall' | 'transcriptPostProcessingEnabled'
  | 'mcpMessageQueueEnabled' | 'mcpVerifyCompletionEnabled' | 'mcpFinalSummaryEnabled'
  | 'memoriesEnabled' | 'dualModelInjectMemories' | 'dualModelEnabled' | 'dualModelAutoSaveImportant'
  | 'mcpParallelToolExecution' | 'mcpContextReductionEnabled' | 'acpInjectBuiltinTools'
  | 'ttsAutoPlay' | 'ttsPreprocessingEnabled' | 'ttsRemoveCodeBlocks' | 'ttsRemoveUrls'
  | 'ttsConvertMarkdown' | 'ttsUseLLMPreprocessing'
  | 'langfuseEnabled'

// Labels for all toggle keys
const TOGGLE_LABELS: Record<ToggleKey, string> = {
  ttsEnabled: 'Text-to-Speech',
  ttsAutoPlay: 'TTS Auto-Play',
  ttsPreprocessingEnabled: 'TTS Preprocessing',
  ttsRemoveCodeBlocks: 'TTS Remove Code Blocks',
  ttsRemoveUrls: 'TTS Remove URLs',
  ttsConvertMarkdown: 'TTS Convert Markdown',
  ttsUseLLMPreprocessing: 'TTS Use LLM Preprocessing',
  mcpRequireApprovalBeforeToolCall: 'Require Tool Approval',
  transcriptPostProcessingEnabled: 'Transcript Post-Processing',
  mcpMessageQueueEnabled: 'Message Queue',
  mcpVerifyCompletionEnabled: 'Verify Completion',
  mcpFinalSummaryEnabled: 'Final Summary',
  memoriesEnabled: 'Memories',
  dualModelInjectMemories: 'Inject Memories',
  dualModelEnabled: 'Summarization (Dual-Model)',
  dualModelAutoSaveImportant: 'Auto-save Important Summaries',
  mcpParallelToolExecution: 'Parallel Tool Execution',
  mcpContextReductionEnabled: 'Context Reduction',
  acpInjectBuiltinTools: 'ACP Inject Builtin Tools',
  langfuseEnabled: 'Enable Langfuse Tracing',
}

interface FormState {
  providerId: string
  model: string
  maxIterations: number
  // All boolean toggles
  ttsEnabled: boolean
  mcpRequireApprovalBeforeToolCall: boolean
  transcriptPostProcessingEnabled: boolean
  mcpMessageQueueEnabled: boolean
  mcpVerifyCompletionEnabled: boolean
  mcpFinalSummaryEnabled: boolean
  memoriesEnabled: boolean
  dualModelInjectMemories: boolean
  dualModelEnabled: boolean
  dualModelAutoSaveImportant: boolean
  mcpParallelToolExecution: boolean
  mcpContextReductionEnabled: boolean
  acpInjectBuiltinTools: boolean
  ttsAutoPlay: boolean
  ttsPreprocessingEnabled: boolean
  ttsRemoveCodeBlocks: boolean
  ttsRemoveUrls: boolean
  ttsConvertMarkdown: boolean
  ttsUseLLMPreprocessing: boolean
  langfuseEnabled: boolean
  // API keys
  openaiApiKey: string
  groqApiKey: string
  geminiApiKey: string
  // Langfuse keys
  langfusePublicKey: string
  langfuseSecretKey: string
  langfuseBaseUrl: string
  // Other
  currentModelPresetId: string
  serverEnabled: Map<string, boolean>
}

export class SettingsView extends BaseView {
  private settings: Settings | null = null
  private mcpServers: McpServer[] = []
  private modelsForProvider: Array<{ id: string; name: string }> = []

  // Model presets
  private modelPresets: ModelPreset[] = []

  // Form state (current values being edited)
  private formState: FormState = {
    providerId: 'openai',
    model: 'gpt-4o-mini',
    maxIterations: 10,
    ttsEnabled: true,
    mcpRequireApprovalBeforeToolCall: false,
    transcriptPostProcessingEnabled: true,
    mcpMessageQueueEnabled: true,
    mcpVerifyCompletionEnabled: true,
    mcpFinalSummaryEnabled: true,
    memoriesEnabled: true,
    dualModelInjectMemories: false,
    dualModelEnabled: false,
    dualModelAutoSaveImportant: false,
    mcpParallelToolExecution: true,
    mcpContextReductionEnabled: true,
    acpInjectBuiltinTools: true,
    ttsAutoPlay: true,
    ttsPreprocessingEnabled: true,
    ttsRemoveCodeBlocks: true,
    ttsRemoveUrls: true,
    ttsConvertMarkdown: true,
    ttsUseLLMPreprocessing: false,
    langfuseEnabled: false,
    openaiApiKey: '',
    groqApiKey: '',
    geminiApiKey: '',
    langfusePublicKey: '',
    langfuseSecretKey: '',
    langfuseBaseUrl: '',
    currentModelPresetId: 'builtin-openai',
    serverEnabled: new Map(),
  }

  // API key inputs
  private apiKeyInputs: Map<string, InputRenderable> = new Map()

  // Langfuse key inputs
  private langfuseInputs: Map<string, InputRenderable> = new Map()

  // Original state for reset
  private originalState: FormState | null = null

  // UI components
  private presetSelect: SelectRenderable | null = null
  private providerSelect: SelectRenderable | null = null
  private modelSelect: SelectRenderable | null = null
  private maxIterInput: InputRenderable | null = null
  private serverToggles: Map<string, TextRenderable> = new Map()
  private toggleElements: Map<string, TextRenderable> = new Map()
  private statusText: TextRenderable | null = null

  // Focus management
  private focusedField: 'preset' | 'provider' | 'model' | 'maxIter' | 'apiKeys' | 'agentToggles' | 'ttsToggles' | 'langfuse' | 'toggles' | 'servers' | 'buttons' = 'preset'
  private selectedApiKeyIndex: number = 0
  private apiKeyProviders: Array<{ key: 'openaiApiKey' | 'groqApiKey' | 'geminiApiKey'; label: string }> = [
    { key: 'openaiApiKey', label: 'OpenAI' },
    { key: 'groqApiKey', label: 'Groq' },
    { key: 'geminiApiKey', label: 'Gemini' },
  ]
  private selectedServerIndex: number = 0
  private selectedToggleIndex: number = 0
  private selectedButton: 'save' | 'reset' = 'save'

  // Toggle keys grouped by section
  private toggleKeys: ToggleKey[] = [
    'ttsEnabled', 'mcpRequireApprovalBeforeToolCall', 'transcriptPostProcessingEnabled'
  ]

  private agentToggleKeys: ToggleKey[] = [
    'mcpMessageQueueEnabled', 'mcpVerifyCompletionEnabled', 'mcpFinalSummaryEnabled',
    'memoriesEnabled', 'dualModelInjectMemories', 'dualModelEnabled', 'dualModelAutoSaveImportant',
    'mcpParallelToolExecution', 'mcpContextReductionEnabled', 'acpInjectBuiltinTools',
  ]

  private ttsToggleKeys: ToggleKey[] = [
    'ttsAutoPlay', 'ttsPreprocessingEnabled', 'ttsRemoveCodeBlocks',
    'ttsRemoveUrls', 'ttsConvertMarkdown', 'ttsUseLLMPreprocessing',
  ]

  private langfuseToggleKeys: ToggleKey[] = ['langfuseEnabled']

  // Section-specific indices
  private selectedAgentToggleIndex: number = 0
  private selectedTtsToggleIndex: number = 0
  private selectedLangfuseIndex: number = 0 // 0=toggle, 1..3=inputs
  private langfuseKeyProviders: Array<{ key: 'langfusePublicKey' | 'langfuseSecretKey' | 'langfuseBaseUrl'; label: string }> = [
    { key: 'langfusePublicKey', label: 'Public Key' },
    { key: 'langfuseSecretKey', label: 'Secret Key' },
    { key: 'langfuseBaseUrl', label: 'Base URL' },
  ]

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load settings and MCP servers
    await this.loadData()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)

    // Focus the preset select
    if (this.presetSelect) {
      this.presetSelect.focus()
    }
  }

  hide(): void {
    // Clear component references
    this.presetSelect = null
    this.providerSelect = null
    this.modelSelect = null
    this.maxIterInput = null
    this.serverToggles.clear()
    this.toggleElements.clear()
    this.apiKeyInputs.clear()
    this.langfuseInputs.clear()
    this.statusText = null
    super.hide()
  }

  protected async createContent(): Promise<BoxRenderable> {
    const view = new BoxRenderable(this.renderer, {
      id: 'settings-view',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'settings-header',
      width: '100%',
      height: 1,
      backgroundColor: '#2e2e1a',
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'settings-header-text',
      content: ' Settings                                     [Tab] Navigate',
      fg: '#FFFFFF',
    })
    header.add(headerText)
    view.add(header)

    // Content area
    const contentContainer = new BoxRenderable(this.renderer, {
      id: 'settings-content',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      padding: 1,
    })

    // LLM Settings Section
    const llmSection = new BoxRenderable(this.renderer, {
      id: 'llm-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const llmTitle = new TextRenderable(this.renderer, {
      id: 'llm-title',
      content: '-- LLM Configuration --',
      fg: '#AAAAAA',
    })
    llmSection.add(llmTitle)

    // Model Preset dropdown
    const presetRow = new BoxRenderable(this.renderer, {
      id: 'preset-row',
      width: '100%',
      height: 3,
      flexDirection: 'row',
      marginTop: 1,
    })
    const presetLabel = new TextRenderable(this.renderer, {
      id: 'preset-label',
      content: '  Model Preset     ',
      fg: '#FFFFFF',
    })
    presetRow.add(presetLabel)

    this.presetSelect = new SelectRenderable(this.renderer, {
      id: 'preset-select',
      width: 25,
      height: 3,
      options: this.modelPresets.map(p => ({ name: p.name, description: p.isBuiltIn ? '(built-in)' : '' })),
    })
    const presetIndex = this.modelPresets.findIndex(p => p.id === this.formState.currentModelPresetId)
    if (presetIndex >= 0) {
      this.presetSelect.setSelectedIndex(presetIndex)
    }
    this.presetSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      this.onPresetChange(index)
    })
    presetRow.add(this.presetSelect)
    llmSection.add(presetRow)

    // Provider dropdown
    const providerRow = new BoxRenderable(this.renderer, {
      id: 'provider-row',
      width: '100%',
      height: 3,
      flexDirection: 'row',
    })
    const providerLabel = new TextRenderable(this.renderer, {
      id: 'provider-label',
      content: '  LLM Provider     ',
      fg: '#FFFFFF',
    })
    providerRow.add(providerLabel)

    this.providerSelect = new SelectRenderable(this.renderer, {
      id: 'provider-select',
      width: 25,
      height: 3,
      options: PROVIDERS.map(p => ({ name: p.name, description: '' })),
    })
    // Set initial selection
    const providerIndex = PROVIDERS.findIndex(p => p.id === this.formState.providerId)
    if (providerIndex >= 0) {
      this.providerSelect.setSelectedIndex(providerIndex)
    }
    this.providerSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      this.onProviderChange(index)
    })
    providerRow.add(this.providerSelect)
    llmSection.add(providerRow)

    // Model dropdown
    const modelRow = new BoxRenderable(this.renderer, {
      id: 'model-row',
      width: '100%',
      height: 3,
      flexDirection: 'row',
    })
    const modelLabel = new TextRenderable(this.renderer, {
      id: 'model-label',
      content: '  Model            ',
      fg: '#FFFFFF',
    })
    modelRow.add(modelLabel)

    const modelOptions = this.modelsForProvider.length > 0
      ? this.modelsForProvider.map(m => ({ name: m.name || m.id, description: '' }))
      : [{ name: this.formState.model, description: '' }]

    this.modelSelect = new SelectRenderable(this.renderer, {
      id: 'model-select',
      width: 30,
      height: 3,
      options: modelOptions,
    })
    const modelIndex = this.modelsForProvider.findIndex(m => m.id === this.formState.model)
    if (modelIndex >= 0) {
      this.modelSelect.setSelectedIndex(modelIndex)
    }
    this.modelSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      this.onModelChange(index)
    })
    modelRow.add(this.modelSelect)
    llmSection.add(modelRow)

    // Max iterations input
    const maxIterRow = new BoxRenderable(this.renderer, {
      id: 'maxiter-row',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      marginTop: 1,
    })
    const maxIterLabel = new TextRenderable(this.renderer, {
      id: 'maxiter-label',
      content: '  Max Iterations   ',
      fg: '#FFFFFF',
    })
    maxIterRow.add(maxIterLabel)

    this.maxIterInput = new InputRenderable(this.renderer, {
      id: 'maxiter-input',
      width: 10,
      height: 1,
      placeholder: '10',
      focusedBackgroundColor: '#2a2a2a',
    })
    this.maxIterInput.value = String(this.formState.maxIterations)
    this.maxIterInput.on(InputRenderableEvents.CHANGE, (value: string) => {
      this.onMaxIterChange(value)
    })
    maxIterRow.add(this.maxIterInput)
    llmSection.add(maxIterRow)

    contentContainer.add(llmSection)

    // API Keys Section
    const apiKeysSection = new BoxRenderable(this.renderer, {
      id: 'apikeys-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const apiKeysTitle = new TextRenderable(this.renderer, {
      id: 'apikeys-title',
      content: '-- API Keys --  (enter key, leave blank to keep current)',
      fg: '#AAAAAA',
    })
    apiKeysSection.add(apiKeysTitle)

    this.apiKeyInputs.clear()
    for (const { key, label } of this.apiKeyProviders) {
      const row = new BoxRenderable(this.renderer, {
        id: `apikey-row-${key}`,
        width: '100%',
        height: 1,
        flexDirection: 'row',
      })
      const keyLabel = new TextRenderable(this.renderer, {
        id: `apikey-label-${key}`,
        content: `  ${label.padEnd(15)}`,
        fg: '#FFFFFF',
      })
      row.add(keyLabel)

      const keyInput = new InputRenderable(this.renderer, {
        id: `apikey-input-${key}`,
        width: 35,
        height: 1,
        placeholder: this.formState[key] || 'not set',
        focusedBackgroundColor: '#2a2a2a',
      })
      keyInput.on(InputRenderableEvents.CHANGE, (value: string) => {
        this.formState[key] = value
      })
      row.add(keyInput)
      this.apiKeyInputs.set(key, keyInput)

      apiKeysSection.add(row)
    }

    contentContainer.add(apiKeysSection)

    // General Settings Section (toggles)
    const generalSection = new BoxRenderable(this.renderer, {
      id: 'general-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const generalTitle = new TextRenderable(this.renderer, {
      id: 'general-title',
      content: '-- General Settings --  [Space] Toggle',
      fg: '#AAAAAA',
    })
    generalSection.add(generalTitle)

    // Create toggle elements dynamically for general toggles
    for (const key of this.toggleKeys) {
      const enabled = this.formState[key] as boolean
      const toggle = new TextRenderable(this.renderer, {
        id: `toggle-${key}`,
        content: this.formatToggle(TOGGLE_LABELS[key], enabled),
        fg: enabled ? '#88FF88' : '#888888',
      })
      generalSection.add(toggle)
      this.toggleElements.set(key, toggle)
    }

    contentContainer.add(generalSection)

    // Agent Settings Section
    const agentSection = new BoxRenderable(this.renderer, {
      id: 'agent-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const agentTitle = new TextRenderable(this.renderer, {
      id: 'agent-title',
      content: '-- Agent Settings --  [Space] Toggle',
      fg: '#AAAAAA',
    })
    agentSection.add(agentTitle)

    for (const key of this.agentToggleKeys) {
      const enabled = this.formState[key] as boolean
      const toggle = new TextRenderable(this.renderer, {
        id: `toggle-${key}`,
        content: this.formatToggle(TOGGLE_LABELS[key], enabled),
        fg: enabled ? '#88FF88' : '#888888',
      })
      agentSection.add(toggle)
      this.toggleElements.set(key, toggle)
    }

    contentContainer.add(agentSection)

    // TTS Settings Section
    const ttsSection = new BoxRenderable(this.renderer, {
      id: 'tts-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const ttsTitle = new TextRenderable(this.renderer, {
      id: 'tts-title',
      content: '-- TTS Settings --  [Space] Toggle',
      fg: '#AAAAAA',
    })
    ttsSection.add(ttsTitle)

    for (const key of this.ttsToggleKeys) {
      const enabled = this.formState[key] as boolean
      const toggle = new TextRenderable(this.renderer, {
        id: `toggle-${key}`,
        content: this.formatToggle(TOGGLE_LABELS[key], enabled),
        fg: enabled ? '#88FF88' : '#888888',
      })
      ttsSection.add(toggle)
      this.toggleElements.set(key, toggle)
    }

    contentContainer.add(ttsSection)

    // Langfuse Observability Section
    const langfuseSection = new BoxRenderable(this.renderer, {
      id: 'langfuse-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
      marginBottom: 1,
    })

    const langfuseTitle = new TextRenderable(this.renderer, {
      id: 'langfuse-title',
      content: '-- Langfuse Observability --',
      fg: '#AAAAAA',
    })
    langfuseSection.add(langfuseTitle)

    // Langfuse enable toggle
    for (const key of this.langfuseToggleKeys) {
      const enabled = this.formState[key] as boolean
      const toggle = new TextRenderable(this.renderer, {
        id: `toggle-${key}`,
        content: this.formatToggle(TOGGLE_LABELS[key], enabled),
        fg: enabled ? '#88FF88' : '#888888',
      })
      langfuseSection.add(toggle)
      this.toggleElements.set(key, toggle)
    }

    // Langfuse key inputs
    this.langfuseInputs.clear()
    for (const { key, label } of this.langfuseKeyProviders) {
      const row = new BoxRenderable(this.renderer, {
        id: `langfuse-row-${key}`,
        width: '100%',
        height: 1,
        flexDirection: 'row',
      })
      const keyLabel = new TextRenderable(this.renderer, {
        id: `langfuse-label-${key}`,
        content: `  ${label.padEnd(15)}`,
        fg: '#FFFFFF',
      })
      row.add(keyLabel)

      const keyInput = new InputRenderable(this.renderer, {
        id: `langfuse-input-${key}`,
        width: 35,
        height: 1,
        placeholder: this.formState[key] || 'not set',
        focusedBackgroundColor: '#2a2a2a',
      })
      keyInput.on(InputRenderableEvents.CHANGE, (value: string) => {
        (this.formState as Record<string, unknown>)[key] = value
      })
      row.add(keyInput)
      this.langfuseInputs.set(key, keyInput)

      langfuseSection.add(row)
    }

    contentContainer.add(langfuseSection)

    // MCP Servers Section
    const mcpSection = new BoxRenderable(this.renderer, {
      id: 'mcp-section',
      width: '100%',
      borderStyle: 'single',
      borderColor: '#444444',
      padding: 1,
    })

    const mcpTitle = new TextRenderable(this.renderer, {
      id: 'mcp-title',
      content: '-- MCP Servers --  [Space] Toggle',
      fg: '#AAAAAA',
    })
    mcpSection.add(mcpTitle)

    if (this.mcpServers.length === 0) {
      const noServers = new TextRenderable(this.renderer, {
        id: 'no-servers',
        content: '  No MCP servers configured',
        fg: '#888888',
      })
      mcpSection.add(noServers)
    } else {
      for (const server of this.mcpServers) {
        const serverText = this.createServerToggle(server)
        mcpSection.add(serverText)
        this.serverToggles.set(server.name, serverText)
      }
    }

    contentContainer.add(mcpSection)

    // Buttons row
    const buttonRow = new BoxRenderable(this.renderer, {
      id: 'button-row',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      marginTop: 1,
      justifyContent: 'flex-end',
      paddingRight: 2,
    })

    const saveBtn = new TextRenderable(this.renderer, {
      id: 'save-btn',
      content: ' [S] Save ',
      fg: '#88FF88',
    })
    buttonRow.add(saveBtn)

    const spacer = new TextRenderable(this.renderer, {
      id: 'btn-spacer',
      content: '  ',
      fg: '#333333',
    })
    buttonRow.add(spacer)

    const resetBtn = new TextRenderable(this.renderer, {
      id: 'reset-btn',
      content: ' [R] Reset ',
      fg: '#FFAA88',
    })
    buttonRow.add(resetBtn)

    contentContainer.add(buttonRow)

    // Status message
    this.statusText = new TextRenderable(this.renderer, {
      id: 'status-text',
      content: '',
      fg: '#888888',
    })
    contentContainer.add(this.statusText)

    view.add(contentContainer)

    // Footer with keybindings
    const footer = new BoxRenderable(this.renderer, {
      id: 'settings-footer',
      width: '100%',
      height: 1,
      backgroundColor: '#333333',
    })
    const footerText = new TextRenderable(this.renderer, {
      id: 'settings-footer-text',
      content: ' [S] Save  [R] Reset  [Space] Toggle  [Tab] Next field  [Up/Dn] Navigate',
      fg: '#AAAAAA',
    })
    footer.add(footerText)
    view.add(footer)

    return view
  }

  private formatToggle(label: string, enabled: boolean): string {
    const icon = enabled ? 'x' : ' '
    return `  [${icon}] ${label}`
  }

  // Generic toggle/highlight helpers for any section's toggle keys
  private toggleInSection(keys: ToggleKey[], index: number): void {
    const key = keys[index]
    if (!key) return

    this.formState[key] = !this.formState[key]

    const toggle = this.toggleElements.get(key)
    if (toggle) {
      toggle.content = this.formatToggle(TOGGLE_LABELS[key], this.formState[key] as boolean)
      toggle.fg = this.formState[key] ? '#88FF88' : '#888888'
    }

    this.setStatus(`${TOGGLE_LABELS[key]}: ${this.formState[key] ? 'enabled' : 'disabled'}`)
  }

  private highlightSection(keys: ToggleKey[], selectedIndex: number): void {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const toggle = this.toggleElements.get(key)
      if (!toggle) continue

      const enabled = this.formState[key] as boolean
      const prefix = i === selectedIndex ? '> ' : '  '
      const icon = enabled ? 'x' : ' '
      toggle.content = `${prefix}[${icon}] ${TOGGLE_LABELS[key]}`
      toggle.fg = i === selectedIndex ? '#FFFFFF' : (enabled ? '#88FF88' : '#888888')
    }
  }

  private toggleSelectedGeneralSetting(): void {
    this.toggleInSection(this.toggleKeys, this.selectedToggleIndex)
  }

  private selectNextToggle(): void {
    this.selectedToggleIndex = (this.selectedToggleIndex + 1) % this.toggleKeys.length
    this.highlightSelectedToggle()
  }

  private selectPrevToggle(): void {
    this.selectedToggleIndex = (this.selectedToggleIndex - 1 + this.toggleKeys.length) % this.toggleKeys.length
    this.highlightSelectedToggle()
  }

  private highlightSelectedToggle(): void {
    this.highlightSection(this.toggleKeys, this.selectedToggleIndex)
  }

  private createServerToggle(server: McpServer): TextRenderable {
    const enabled = this.formState.serverEnabled.get(server.name) ?? (server.status === 'connected')
    const icon = enabled ? 'x' : ' '
    const color = enabled ? '#88FF88' : '#888888'
    const toolsInfo = `${String(server.toolCount).padStart(2)} tools`

    return new TextRenderable(this.renderer, {
      id: `server-toggle-${server.name}`,
      content: `  [${icon}] ${server.name.padEnd(20)} ${toolsInfo}`,
      fg: color,
    })
  }

  private updateServerToggle(serverName: string): void {
    const server = this.mcpServers.find(s => s.name === serverName)
    const toggle = this.serverToggles.get(serverName)
    if (!server || !toggle) return

    const enabled = this.formState.serverEnabled.get(serverName) ?? (server.status === 'connected')
    const icon = enabled ? 'x' : ' '
    const color = enabled ? '#88FF88' : '#888888'
    const toolsInfo = `${String(server.toolCount).padStart(2)} tools`

    toggle.content = `  [${icon}] ${server.name.padEnd(20)} ${toolsInfo}`
    toggle.fg = color
  }

  private async loadData(): Promise<void> {
    try {
      const [settings, serversResult, presetsResult] = await Promise.all([
        this.client.getSettings(),
        this.client.getMcpServers(),
        this.client.getModelPresets().catch(() => ({ presets: [], currentPresetId: 'builtin-openai' })),
      ])
      this.settings = settings
      this.mcpServers = serversResult.servers || []
      this.modelPresets = presetsResult.presets || []

      // Initialize form state from settings
      const providerId = settings.mcpToolsProviderId || 'openai'
      this.formState = {
        providerId,
        model: this.getActiveModel(settings, providerId),
        maxIterations: settings.mcpMaxIterations || 10,
        // General toggles
        ttsEnabled: settings.ttsEnabled ?? true,
        mcpRequireApprovalBeforeToolCall: settings.mcpRequireApprovalBeforeToolCall ?? false,
        transcriptPostProcessingEnabled: settings.transcriptPostProcessingEnabled ?? true,
        // Agent toggles
        mcpMessageQueueEnabled: settings.mcpMessageQueueEnabled ?? true,
        mcpVerifyCompletionEnabled: settings.mcpVerifyCompletionEnabled ?? true,
        mcpFinalSummaryEnabled: settings.mcpFinalSummaryEnabled ?? true,
        memoriesEnabled: settings.memoriesEnabled ?? true,
        dualModelInjectMemories: settings.dualModelInjectMemories ?? false,
        dualModelEnabled: settings.dualModelEnabled ?? false,
        dualModelAutoSaveImportant: settings.dualModelAutoSaveImportant ?? false,
        mcpParallelToolExecution: settings.mcpParallelToolExecution ?? true,
        mcpContextReductionEnabled: settings.mcpContextReductionEnabled ?? true,
        acpInjectBuiltinTools: settings.acpInjectBuiltinTools ?? true,
        // TTS toggles
        ttsAutoPlay: settings.ttsAutoPlay ?? true,
        ttsPreprocessingEnabled: settings.ttsPreprocessingEnabled ?? true,
        ttsRemoveCodeBlocks: settings.ttsRemoveCodeBlocks ?? true,
        ttsRemoveUrls: settings.ttsRemoveUrls ?? true,
        ttsConvertMarkdown: settings.ttsConvertMarkdown ?? true,
        ttsUseLLMPreprocessing: settings.ttsUseLLMPreprocessing ?? false,
        // Langfuse
        langfuseEnabled: settings.langfuseEnabled ?? false,
        langfusePublicKey: settings.langfusePublicKey || '',
        langfuseSecretKey: settings.langfuseSecretKey || '',
        langfuseBaseUrl: settings.langfuseBaseUrl || '',
        // API keys
        openaiApiKey: settings.openaiApiKey || '',
        groqApiKey: settings.groqApiKey || '',
        geminiApiKey: settings.geminiApiKey || '',
        currentModelPresetId: presetsResult.currentPresetId || settings.currentModelPresetId || 'builtin-openai',
        serverEnabled: new Map(
          this.mcpServers.map(s => [s.name, s.status === 'connected'])
        ),
      }

      // Store original state for reset
      this.originalState = {
        ...this.formState,
        serverEnabled: new Map(this.formState.serverEnabled),
      }

      // Load models for current provider
      await this.loadModelsForProvider(providerId)
    } catch {
      // Ignore errors
    }
  }

  private async loadModelsForProvider(providerId: string): Promise<void> {
    try {
      const result = await this.client.getModelsForProvider(providerId)
      this.modelsForProvider = result.models || []
    } catch {
      this.modelsForProvider = []
    }
  }

  private getActiveModel(settings: Settings, providerId: string): string {
    switch (providerId) {
      case 'openai':
        return settings.mcpToolsOpenaiModel || 'gpt-4o-mini'
      case 'groq':
        return settings.mcpToolsGroqModel || 'llama-3.3-70b-versatile'
      case 'gemini':
        return settings.mcpToolsGeminiModel || 'gemini-2.0-flash-exp'
      default:
        return 'unknown'
    }
  }

  private getModelSettingKey(providerId: string): keyof Settings {
    switch (providerId) {
      case 'openai':
        return 'mcpToolsOpenaiModel'
      case 'groq':
        return 'mcpToolsGroqModel'
      case 'gemini':
        return 'mcpToolsGeminiModel'
      default:
        return 'mcpToolsOpenaiModel'
    }
  }

  // Event handlers
  private async onProviderChange(index: number): Promise<void> {
    const provider = PROVIDERS[index]
    if (!provider) return

    this.formState.providerId = provider.id
    this.setStatus(`Loading models for ${provider.name}...`)

    // Load models for new provider
    await this.loadModelsForProvider(provider.id)

    // Update model select options
    if (this.modelSelect && this.modelsForProvider.length > 0) {
      // Get default model for this provider
      const defaultModel = this.getActiveModel(this.settings || {}, provider.id)
      const modelIndex = this.modelsForProvider.findIndex(m => m.id === defaultModel)

      this.formState.model = modelIndex >= 0
        ? this.modelsForProvider[modelIndex].id
        : this.modelsForProvider[0].id

      // Refresh the view to update model select
      await this.refresh()
    }

    this.setStatus(`Provider changed to ${provider.name}`)
  }

  private onPresetChange(index: number): void {
    const preset = this.modelPresets[index]
    if (!preset) return

    this.formState.currentModelPresetId = preset.id
    this.setStatus(`Model preset changed to ${preset.name}`)
  }

  private onModelChange(index: number): void {
    const model = this.modelsForProvider[index]
    if (!model) return

    this.formState.model = model.id
    this.setStatus(`Model changed to ${model.name || model.id}`)
  }

  private onMaxIterChange(value: string): void {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num > 0 && num <= 100) {
      this.formState.maxIterations = num
    }
  }

  // Public methods for keyboard handling from App
  async handleKeyPress(key: KeyEvent): Promise<void> {
    const name = key.name || ''

    switch (name) {
      case 'enter':
        if (this.focusedField === 'buttons') {
          if (this.selectedButton === 'save') {
            await this.saveSettings()
          } else {
            await this.resetSettings()
          }
        }
        break
      case 'escape':
        await this.resetSettings()
        break
      case 'space':
      case ' ':
        if (this.focusedField === 'toggles') {
          this.toggleSelectedGeneralSetting()
        } else if (this.focusedField === 'agentToggles') {
          this.toggleInSection(this.agentToggleKeys, this.selectedAgentToggleIndex)
        } else if (this.focusedField === 'ttsToggles') {
          this.toggleInSection(this.ttsToggleKeys, this.selectedTtsToggleIndex)
        } else if (this.focusedField === 'langfuse') {
          // Only toggle if on the toggle item (index 0)
          if (this.selectedLangfuseIndex === 0) {
            this.toggleInSection(this.langfuseToggleKeys, 0)
          }
        } else if (this.focusedField === 'servers') {
          this.toggleSelectedServer()
        }
        break
      case 'down':
        if (this.focusedField === 'toggles') {
          this.selectNextToggle()
        } else if (this.focusedField === 'agentToggles') {
          this.selectedAgentToggleIndex = (this.selectedAgentToggleIndex + 1) % this.agentToggleKeys.length
          this.highlightSection(this.agentToggleKeys, this.selectedAgentToggleIndex)
        } else if (this.focusedField === 'ttsToggles') {
          this.selectedTtsToggleIndex = (this.selectedTtsToggleIndex + 1) % this.ttsToggleKeys.length
          this.highlightSection(this.ttsToggleKeys, this.selectedTtsToggleIndex)
        } else if (this.focusedField === 'langfuse') {
          // 0=toggle, 1..3=inputs
          const langfuseCount = 1 + this.langfuseKeyProviders.length
          this.selectedLangfuseIndex = (this.selectedLangfuseIndex + 1) % langfuseCount
          this.focusLangfuseItem()
        } else if (this.focusedField === 'apiKeys') {
          this.selectedApiKeyIndex = (this.selectedApiKeyIndex + 1) % this.apiKeyProviders.length
          this.focusApiKeyInput()
        } else if (this.focusedField === 'servers') {
          this.selectNextServer()
        } else if (this.focusedField === 'buttons') {
          this.selectedButton = this.selectedButton === 'save' ? 'reset' : 'save'
        }
        break
      case 'up':
        if (this.focusedField === 'toggles') {
          this.selectPrevToggle()
        } else if (this.focusedField === 'agentToggles') {
          this.selectedAgentToggleIndex = (this.selectedAgentToggleIndex - 1 + this.agentToggleKeys.length) % this.agentToggleKeys.length
          this.highlightSection(this.agentToggleKeys, this.selectedAgentToggleIndex)
        } else if (this.focusedField === 'ttsToggles') {
          this.selectedTtsToggleIndex = (this.selectedTtsToggleIndex - 1 + this.ttsToggleKeys.length) % this.ttsToggleKeys.length
          this.highlightSection(this.ttsToggleKeys, this.selectedTtsToggleIndex)
        } else if (this.focusedField === 'langfuse') {
          const langfuseCount = 1 + this.langfuseKeyProviders.length
          this.selectedLangfuseIndex = (this.selectedLangfuseIndex - 1 + langfuseCount) % langfuseCount
          this.focusLangfuseItem()
        } else if (this.focusedField === 'apiKeys') {
          this.selectedApiKeyIndex = (this.selectedApiKeyIndex - 1 + this.apiKeyProviders.length) % this.apiKeyProviders.length
          this.focusApiKeyInput()
        } else if (this.focusedField === 'servers') {
          this.selectPrevServer()
        } else if (this.focusedField === 'buttons') {
          this.selectedButton = this.selectedButton === 'save' ? 'reset' : 'save'
        }
        break
      case 'tab':
        this.focusNextField()
        break
    }

    // Character-based shortcuts (check sequence for S/R)
    const ch = typeof key.sequence === 'string' ? key.sequence.toLowerCase() : ''
    const noShortcutFields: string[] = ['apiKeys', 'maxIter', 'langfuse']
    if (ch === 's' && !noShortcutFields.includes(this.focusedField)) {
      await this.saveSettings()
    } else if (ch === 'r' && !noShortcutFields.includes(this.focusedField)) {
      await this.resetSettings()
    }
  }

  private focusNextField(): void {
    const fields: Array<typeof this.focusedField> =
      ['preset', 'provider', 'model', 'maxIter', 'apiKeys', 'toggles', 'agentToggles', 'ttsToggles', 'langfuse', 'servers', 'buttons']
    const currentIndex = fields.indexOf(this.focusedField)
    this.focusedField = fields[(currentIndex + 1) % fields.length]

    // Focus the appropriate component
    switch (this.focusedField) {
      case 'preset':
        this.presetSelect?.focus()
        break
      case 'provider':
        this.providerSelect?.focus()
        break
      case 'model':
        this.modelSelect?.focus()
        break
      case 'maxIter':
        this.maxIterInput?.focus()
        break
      case 'apiKeys':
        this.focusApiKeyInput()
        break
      case 'toggles':
        this.highlightSelectedToggle()
        break
      case 'agentToggles':
        this.highlightSection(this.agentToggleKeys, this.selectedAgentToggleIndex)
        break
      case 'ttsToggles':
        this.highlightSection(this.ttsToggleKeys, this.selectedTtsToggleIndex)
        break
      case 'langfuse':
        this.focusLangfuseItem()
        break
      case 'servers':
        this.highlightSelectedServer()
        break
      case 'buttons':
        // Visual indication only
        break
    }
  }

  private focusApiKeyInput(): void {
    const provider = this.apiKeyProviders[this.selectedApiKeyIndex]
    if (provider) {
      const input = this.apiKeyInputs.get(provider.key)
      input?.focus()
    }
  }

  private focusLangfuseItem(): void {
    if (this.selectedLangfuseIndex === 0) {
      // Highlight the langfuse toggle
      this.highlightSection(this.langfuseToggleKeys, 0)
    } else {
      // Focus the appropriate langfuse input
      const inputIndex = this.selectedLangfuseIndex - 1
      const provider = this.langfuseKeyProviders[inputIndex]
      if (provider) {
        const input = this.langfuseInputs.get(provider.key)
        input?.focus()
      }
    }
  }

  private toggleSelectedServer(): void {
    if (this.mcpServers.length === 0) return

    const server = this.mcpServers[this.selectedServerIndex]
    if (!server) return

    const current = this.formState.serverEnabled.get(server.name) ?? (server.status === 'connected')
    this.formState.serverEnabled.set(server.name, !current)
    this.updateServerToggle(server.name)
    this.setStatus(`${server.name}: ${!current ? 'enabled' : 'disabled'}`)
  }

  private selectNextServer(): void {
    if (this.mcpServers.length === 0) return
    this.selectedServerIndex = (this.selectedServerIndex + 1) % this.mcpServers.length
    this.highlightSelectedServer()
  }

  private selectPrevServer(): void {
    if (this.mcpServers.length === 0) return
    this.selectedServerIndex = (this.selectedServerIndex - 1 + this.mcpServers.length) % this.mcpServers.length
    this.highlightSelectedServer()
  }

  private highlightSelectedServer(): void {
    // Update visual highlight (add arrow indicator)
    for (let i = 0; i < this.mcpServers.length; i++) {
      const server = this.mcpServers[i]
      const toggle = this.serverToggles.get(server.name)
      if (!toggle) continue

      const enabled = this.formState.serverEnabled.get(server.name) ?? (server.status === 'connected')
      const icon = enabled ? 'x' : ' '
      const color = enabled ? '#88FF88' : '#888888'
      const toolsInfo = `${String(server.toolCount).padStart(2)} tools`
      const prefix = i === this.selectedServerIndex ? '> ' : '  '

      toggle.content = `${prefix}[${icon}] ${server.name.padEnd(20)} ${toolsInfo}`
      toggle.fg = i === this.selectedServerIndex ? '#FFFFFF' : color
    }
  }

  private async saveSettings(): Promise<void> {
    this.setStatus('Saving settings...')

    try {
      // Build settings patch — include all toggle and config fields
      const patch: Partial<Settings> = {
        mcpToolsProviderId: this.formState.providerId,
        mcpMaxIterations: this.formState.maxIterations,
        currentModelPresetId: this.formState.currentModelPresetId,
        // General toggles
        ttsEnabled: this.formState.ttsEnabled,
        mcpRequireApprovalBeforeToolCall: this.formState.mcpRequireApprovalBeforeToolCall,
        transcriptPostProcessingEnabled: this.formState.transcriptPostProcessingEnabled,
        // Agent toggles
        mcpMessageQueueEnabled: this.formState.mcpMessageQueueEnabled,
        mcpVerifyCompletionEnabled: this.formState.mcpVerifyCompletionEnabled,
        mcpFinalSummaryEnabled: this.formState.mcpFinalSummaryEnabled,
        memoriesEnabled: this.formState.memoriesEnabled,
        dualModelInjectMemories: this.formState.dualModelInjectMemories,
        dualModelEnabled: this.formState.dualModelEnabled,
        dualModelAutoSaveImportant: this.formState.dualModelAutoSaveImportant,
        mcpParallelToolExecution: this.formState.mcpParallelToolExecution,
        mcpContextReductionEnabled: this.formState.mcpContextReductionEnabled,
        acpInjectBuiltinTools: this.formState.acpInjectBuiltinTools,
        // TTS toggles
        ttsAutoPlay: this.formState.ttsAutoPlay,
        ttsPreprocessingEnabled: this.formState.ttsPreprocessingEnabled,
        ttsRemoveCodeBlocks: this.formState.ttsRemoveCodeBlocks,
        ttsRemoveUrls: this.formState.ttsRemoveUrls,
        ttsConvertMarkdown: this.formState.ttsConvertMarkdown,
        ttsUseLLMPreprocessing: this.formState.ttsUseLLMPreprocessing,
        // Langfuse
        langfuseEnabled: this.formState.langfuseEnabled,
      }

      // Add API keys only if user entered a new (non-masked) value
      if (this.formState.openaiApiKey && !this.formState.openaiApiKey.startsWith('****')) {
        patch.openaiApiKey = this.formState.openaiApiKey
      }
      if (this.formState.groqApiKey && !this.formState.groqApiKey.startsWith('****')) {
        patch.groqApiKey = this.formState.groqApiKey
      }
      if (this.formState.geminiApiKey && !this.formState.geminiApiKey.startsWith('****')) {
        patch.geminiApiKey = this.formState.geminiApiKey
      }

      // Langfuse keys — same masking logic
      if (this.formState.langfusePublicKey && !this.formState.langfusePublicKey.startsWith('****')) {
        patch.langfusePublicKey = this.formState.langfusePublicKey
      }
      if (this.formState.langfuseSecretKey && !this.formState.langfuseSecretKey.startsWith('****')) {
        patch.langfuseSecretKey = this.formState.langfuseSecretKey
      }
      if (this.formState.langfuseBaseUrl) {
        patch.langfuseBaseUrl = this.formState.langfuseBaseUrl
      }

      // Set the correct model field based on provider
      const modelKey = this.getModelSettingKey(this.formState.providerId)
      patch[modelKey] = this.formState.model

      // Save LLM settings
      await this.client.patchSettings(patch)

      // Toggle MCP servers that changed
      const togglePromises: Promise<unknown>[] = []
      for (const server of this.mcpServers) {
        const wasEnabled = server.status === 'connected'
        const nowEnabled = this.formState.serverEnabled.get(server.name) ?? wasEnabled
        if (wasEnabled !== nowEnabled) {
          togglePromises.push(
            this.client.toggleMcpServer(server.name, nowEnabled)
          )
        }
      }

      if (togglePromises.length > 0) {
        await Promise.all(togglePromises)
      }

      // Update original state
      this.originalState = {
        ...this.formState,
        serverEnabled: new Map(this.formState.serverEnabled),
      }

      this.setStatus('Settings saved successfully!')

      // Reload data to reflect server status changes
      setTimeout(() => this.refresh(), 1000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      this.setStatus(`X Save failed: ${msg}`)
    }
  }

  private async resetSettings(): Promise<void> {
    if (!this.originalState) return

    this.formState = {
      ...this.originalState,
      serverEnabled: new Map(this.originalState.serverEnabled),
    }

    // Refresh the view
    await this.refresh()
    this.setStatus('Settings reset to original values')
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.content = `  ${message}`
    }
  }
}

