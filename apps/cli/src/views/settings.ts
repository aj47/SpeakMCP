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
} from '@opentui/core'

import { BaseView } from './base'
import type { Settings, McpServer } from '../types'

// Provider options
const PROVIDERS = [
  { name: 'OpenAI', id: 'openai' },
  { name: 'Groq', id: 'groq' },
  { name: 'Gemini', id: 'gemini' },
]

interface FormState {
  providerId: string
  model: string
  maxIterations: number
  serverEnabled: Map<string, boolean>
}

export class SettingsView extends BaseView {
  private settings: Settings | null = null
  private mcpServers: McpServer[] = []
  private modelsForProvider: Array<{ id: string; name: string }> = []

  // Form state (current values being edited)
  private formState: FormState = {
    providerId: 'openai',
    model: 'gpt-4o-mini',
    maxIterations: 10,
    serverEnabled: new Map(),
  }

  // Original state for reset
  private originalState: FormState | null = null

  // UI components
  private providerSelect: SelectRenderable | null = null
  private modelSelect: SelectRenderable | null = null
  private maxIterInput: InputRenderable | null = null
  private serverToggles: Map<string, TextRenderable> = new Map()
  private statusText: TextRenderable | null = null

  // Focus management
  private focusedField: 'provider' | 'model' | 'maxIter' | 'servers' | 'buttons' = 'provider'
  private selectedServerIndex: number = 0
  private selectedButton: 'save' | 'reset' = 'save'

  async show(): Promise<void> {
    if (this.isVisible) return
    this.isVisible = true

    // Load settings and MCP servers
    await this.loadData()

    this.viewContainer = await this.createContent()
    this.container.add(this.viewContainer)

    // Focus the provider select
    if (this.providerSelect) {
      this.providerSelect.focus()
    }
  }

  hide(): void {
    // Clear component references
    this.providerSelect = null
    this.modelSelect = null
    this.maxIterInput = null
    this.serverToggles.clear()
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
      content: ' ⚙️  Settings                                  [Tab] Navigate',
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
      content: '─ LLM Configuration ─',
      fg: '#AAAAAA',
    })
    llmSection.add(llmTitle)

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
      content: '─ MCP Servers ─  [Space] Toggle',
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
      content: ' [S] Save  [R] Reset  [Space] Toggle server  [Tab] Next field',
      fg: '#AAAAAA',
    })
    footer.add(footerText)
    view.add(footer)

    return view
  }

  private createServerToggle(server: McpServer): TextRenderable {
    const enabled = this.formState.serverEnabled.get(server.name) ?? (server.status === 'connected')
    const icon = enabled ? '✓' : '○'
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
    const icon = enabled ? '✓' : '○'
    const color = enabled ? '#88FF88' : '#888888'
    const toolsInfo = `${String(server.toolCount).padStart(2)} tools`

    toggle.content = `  [${icon}] ${server.name.padEnd(20)} ${toolsInfo}`
    toggle.fg = color
  }

  private async loadData(): Promise<void> {
    try {
      const [settings, serversResult] = await Promise.all([
        this.client.getSettings(),
        this.client.getMcpServers(),
      ])
      this.settings = settings
      this.mcpServers = serversResult.servers || []

      // Initialize form state from settings
      const providerId = settings.mcpToolsProviderId || 'openai'
      this.formState = {
        providerId,
        model: this.getActiveModel(settings, providerId),
        maxIterations: settings.mcpMaxIterations || 10,
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
  async handleKeyPress(key: string): Promise<void> {
    switch (key.toLowerCase()) {
      case 's':
      case 'enter':
        await this.saveSettings()
        break
      case 'r':
      case 'escape':
        await this.resetSettings()
        break
      case ' ':
        this.toggleSelectedServer()
        break
      case 'j':
      case 'down':
        this.selectNextServer()
        break
      case 'k':
      case 'up':
        this.selectPrevServer()
        break
      case 'tab':
        this.focusNextField()
        break
    }
  }

  private focusNextField(): void {
    const fields: Array<'provider' | 'model' | 'maxIter' | 'servers' | 'buttons'> =
      ['provider', 'model', 'maxIter', 'servers', 'buttons']
    const currentIndex = fields.indexOf(this.focusedField)
    this.focusedField = fields[(currentIndex + 1) % fields.length]

    // Focus the appropriate component
    switch (this.focusedField) {
      case 'provider':
        this.providerSelect?.focus()
        break
      case 'model':
        this.modelSelect?.focus()
        break
      case 'maxIter':
        this.maxIterInput?.focus()
        break
      case 'servers':
        this.highlightSelectedServer()
        break
      case 'buttons':
        // Visual indication only
        break
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
      const icon = enabled ? '✓' : '○'
      const color = enabled ? '#88FF88' : '#888888'
      const toolsInfo = `${String(server.toolCount).padStart(2)} tools`
      const prefix = i === this.selectedServerIndex ? '► ' : '  '

      toggle.content = `${prefix}[${icon}] ${server.name.padEnd(20)} ${toolsInfo}`
      toggle.fg = i === this.selectedServerIndex ? '#FFFFFF' : color
    }
  }

  private async saveSettings(): Promise<void> {
    this.setStatus('Saving settings...')

    try {
      // Build settings patch
      const patch: Partial<Settings> = {
        mcpToolsProviderId: this.formState.providerId,
        mcpMaxIterations: this.formState.maxIterations,
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

      this.setStatus('✓ Settings saved successfully!')

      // Reload data to reflect server status changes
      setTimeout(() => this.refresh(), 1000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      this.setStatus(`✗ Save failed: ${msg}`)
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

