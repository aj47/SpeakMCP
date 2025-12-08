import { useState, useMemo, useCallback } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { ModelPreset, Config } from "@shared/types"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Key, Globe, Bot, FileText, Settings2 } from "lucide-react"
import { getBuiltInModelPresets, DEFAULT_MODEL_PRESET_ID } from "@shared/index"
import { PresetModelSelector } from "./preset-model-selector"
import { ModelSelector } from "./model-selector"

export function ModelPresetManager() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<ModelPreset | null>(null)
  const [newPreset, setNewPreset] = useState<Partial<ModelPreset>>({
    name: "",
    baseUrl: "",
    apiKey: "",
    mcpToolsModel: "",
    transcriptProcessingModel: "",
  })

  const config = configQuery.data

  // Combine built-in presets with custom presets from config
  const allPresets = useMemo(() => {
    const builtIn = getBuiltInModelPresets()
    const custom = config?.modelPresets || []

    // Merge built-in presets with any saved data (API keys, model preferences, etc.)
    const mergedBuiltIn = builtIn.map(preset => {
      const saved = custom.find(c => c.id === preset.id)
      if (saved) {
        // Merge all saved properties (apiKey, mcpToolsModel, transcriptProcessingModel, etc.)
        return { ...preset, ...saved }
      }
      // For builtin-openai, seed with legacy openaiApiKey if no saved preset exists
      if (preset.id === DEFAULT_MODEL_PRESET_ID && config?.openaiApiKey) {
        return { ...preset, apiKey: config.openaiApiKey }
      }
      return preset
    })

    // Add custom (non-built-in) presets
    const customOnly = custom.filter(c => !c.isBuiltIn)
    return [...mergedBuiltIn, ...customOnly]
  }, [config?.modelPresets, config?.openaiApiKey])

  const currentPresetId = config?.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  const currentPreset = allPresets.find(p => p.id === currentPresetId)

  const saveConfig = useCallback((updates: Partial<Config>) => {
    saveConfigMutation.mutate({
      config: { ...config, ...updates },
    })
  }, [config, saveConfigMutation])

  // Save model selection to the current preset (called when user changes model)
  // Save model selection to both global config AND the current preset in a single save
  const saveModelWithPreset = useCallback((
    modelType: 'mcpToolsModel' | 'transcriptProcessingModel',
    globalConfigKey: 'mcpToolsOpenaiModel' | 'transcriptPostProcessingOpenaiModel',
    modelId: string
  ) => {
    if (!currentPresetId || !config) return

    const existingPresets = config.modelPresets || []
    const presetIndex = existingPresets.findIndex(p => p.id === currentPresetId)

    let updatedPresets: ModelPreset[]

    if (presetIndex >= 0) {
      // Update existing preset entry
      updatedPresets = existingPresets.map(p =>
        p.id === currentPresetId
          ? { ...p, [modelType]: modelId, updatedAt: Date.now() }
          : p
      )
    } else {
      // Create new entry for built-in preset that hasn't been customized yet
      const builtInPreset = getBuiltInModelPresets().find(p => p.id === currentPresetId)
      if (builtInPreset) {
        updatedPresets = [
          ...existingPresets,
          {
            ...builtInPreset,
            // Don't auto-seed API key from global config - each preset should have its own key
            // configured explicitly to avoid credential misuse across different providers
            apiKey: '',
            [modelType]: modelId,
            updatedAt: Date.now(),
          }
        ]
      } else {
        // Fallback: just save the global config without preset
        saveConfig({ [globalConfigKey]: modelId })
        return
      }
    }

    // Save BOTH the global config field AND the preset in a single call
    saveConfig({
      [globalConfigKey]: modelId,
      modelPresets: updatedPresets
    })
  }, [currentPresetId, config, saveConfig])

  const handlePresetChange = (presetId: string) => {
    const preset = allPresets.find(p => p.id === presetId)
    if (preset) {
      const updates: Partial<Config> = {
        currentModelPresetId: presetId,
        // Also update the legacy fields for backward compatibility
        openaiBaseUrl: preset.baseUrl,
        openaiApiKey: preset.apiKey,
      }
      // Apply model preferences if they are set on the preset
      if (preset.mcpToolsModel) {
        updates.mcpToolsOpenaiModel = preset.mcpToolsModel
      }
      if (preset.transcriptProcessingModel) {
        updates.transcriptPostProcessingOpenaiModel = preset.transcriptProcessingModel
      }
      saveConfig(updates)
      toast.success(`Switched to preset: ${preset.name}`)
    }
  }

  const handleCreatePreset = () => {
    if (!newPreset.name?.trim()) {
      toast.error("Preset name is required")
      return
    }
    if (!newPreset.baseUrl?.trim()) {
      toast.error("Base URL is required")
      return
    }

    const id = `custom-${Date.now()}`
    const preset: ModelPreset = {
      id,
      name: newPreset.name.trim(),
      baseUrl: newPreset.baseUrl.trim(),
      apiKey: newPreset.apiKey || "",
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mcpToolsModel: newPreset.mcpToolsModel || "",
      transcriptProcessingModel: newPreset.transcriptProcessingModel || "",
    }

    const existingPresets = config?.modelPresets || []
    saveConfig({
      modelPresets: [...existingPresets, preset],
    })

    setIsCreateDialogOpen(false)
    setNewPreset({ name: "", baseUrl: "", apiKey: "", mcpToolsModel: "", transcriptProcessingModel: "" })
    toast.success("Preset created successfully")
  }

  const handleUpdatePreset = () => {
    if (!editingPreset) return

    const existingPresets = config?.modelPresets || []
    const updatedPresets = existingPresets.map(p =>
      p.id === editingPreset.id
        ? { ...editingPreset, updatedAt: Date.now() }
        : p
    )

    // If it's a built-in preset, we need to add it to save the API key
    const isNewBuiltInSave = editingPreset.isBuiltIn && !existingPresets.find(p => p.id === editingPreset.id)
    const finalPresets = isNewBuiltInSave
      ? [...existingPresets, { ...editingPreset, updatedAt: Date.now() }]
      : updatedPresets

    const updates: Partial<Config> = { modelPresets: finalPresets }

    // If editing the current preset, also update legacy fields
    if (editingPreset.id === currentPresetId) {
      updates.openaiBaseUrl = editingPreset.baseUrl
      updates.openaiApiKey = editingPreset.apiKey
    }

    saveConfig(updates)
    setIsEditDialogOpen(false)
    setEditingPreset(null)
    toast.success("Preset updated successfully")
  }

  const handleDeletePreset = (preset: ModelPreset) => {
    if (preset.isBuiltIn) {
      toast.error("Cannot delete built-in presets")
      return
    }
    if (confirm(`Delete preset "${preset.name}"?`)) {
      const existingPresets = config?.modelPresets || []
      const updates: Partial<Config> = {
        modelPresets: existingPresets.filter(p => p.id !== preset.id),
      }
      // If deleting current preset, switch to default
      if (preset.id === currentPresetId) {
        const defaultPreset = allPresets.find(p => p.id === DEFAULT_MODEL_PRESET_ID)
        updates.currentModelPresetId = DEFAULT_MODEL_PRESET_ID
        // Also update the legacy fields for backward compatibility
        updates.openaiBaseUrl = defaultPreset?.baseUrl || ""
        updates.openaiApiKey = defaultPreset?.apiKey || ""
      }
      saveConfig(updates)
      toast.success("Preset deleted")
    }
  }

  const handleEditPreset = (preset: ModelPreset) => {
    setEditingPreset({ ...preset })
    setIsEditDialogOpen(true)
  }

  if (!config) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Model Provider Preset</Label>
        <div className="flex gap-2">
          {currentPreset && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEditPreset(currentPreset)}
            >
              <Settings2 className="h-3 w-3 mr-1" />
              {currentPreset.isBuiltIn ? "Configure" : "Edit"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            New Preset
          </Button>
        </div>
      </div>

      <Select value={currentPresetId} onValueChange={handlePresetChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a preset" />
        </SelectTrigger>
        <SelectContent>
          {allPresets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              <div className="flex items-center gap-2">
                <span>{preset.name}</span>
                {preset.isBuiltIn && (
                  <span className="text-xs text-muted-foreground">(Built-in)</span>
                )}
                {preset.apiKey && (
                  <Key className="h-3 w-3 text-green-500" />
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {currentPreset && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-4 w-4" />
            <span className="truncate">{currentPreset.baseUrl || "No URL set"}</span>
          </div>

          {/* Inline model selectors - changes are auto-saved to preset */}
          <div className="space-y-3">
            <ModelSelector
              providerId="openai"
              value={config?.mcpToolsOpenaiModel || ""}
              onValueChange={(value) => {
                saveModelWithPreset('mcpToolsModel', 'mcpToolsOpenaiModel', value)
              }}
              label="Agent/MCP Tools Model"
              placeholder="Select model"
            />
            <ModelSelector
              providerId="openai"
              value={config?.transcriptPostProcessingOpenaiModel || ""}
              onValueChange={(value) => {
                saveModelWithPreset('transcriptProcessingModel', 'transcriptPostProcessingOpenaiModel', value)
              }}
              label="Transcript Processing Model"
              placeholder="Select model"
            />
          </div>

          {!currentPreset.isBuiltIn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDeletePreset(currentPreset)}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete Preset
            </Button>
          )}
        </div>
      )}

      {/* Create Preset Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Preset</DialogTitle>
            <DialogDescription>
              Create a custom preset with its own API key, base URL, and model preferences.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="preset-name">Preset Name</Label>
              <Input
                id="preset-name"
                value={newPreset.name}
                onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
                placeholder="e.g., My OpenRouter"
              />
            </div>
            <div>
              <Label htmlFor="preset-url">API Base URL</Label>
              <Input
                id="preset-url"
                type="url"
                value={newPreset.baseUrl}
                onChange={(e) => setNewPreset({ ...newPreset, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div>
              <Label htmlFor="preset-key">API Key</Label>
              <Input
                id="preset-key"
                type="password"
                value={newPreset.apiKey}
                onChange={(e) => setNewPreset({ ...newPreset, apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>

            {/* Model Preferences Section */}
            {newPreset.baseUrl && newPreset.apiKey && (
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Model Preferences (Optional)</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Set default models that will be selected when switching to this preset.
                </p>

                <div className="space-y-4">
                  <PresetModelSelector
                    presetId="new-preset"
                    baseUrl={newPreset.baseUrl || ""}
                    apiKey={newPreset.apiKey || ""}
                    value={newPreset.mcpToolsModel || ""}
                    onValueChange={(value) =>
                      setNewPreset({ ...newPreset, mcpToolsModel: value })
                    }
                    label="Agent/MCP Tools Model"
                    placeholder="Select model for agent mode"
                  />

                  <PresetModelSelector
                    presetId="new-preset"
                    baseUrl={newPreset.baseUrl || ""}
                    apiKey={newPreset.apiKey || ""}
                    value={newPreset.transcriptProcessingModel || ""}
                    onValueChange={(value) =>
                      setNewPreset({ ...newPreset, transcriptProcessingModel: value })
                    }
                    label="Transcript Processing Model"
                    placeholder="Select model for transcripts"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePreset} disabled={saveConfigMutation.isPending}>
              Create Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Preset Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPreset?.isBuiltIn ? "Configure Preset" : "Edit Preset"}
            </DialogTitle>
            <DialogDescription>
              {editingPreset?.isBuiltIn
                ? "Set the API key and model preferences for this built-in preset."
                : "Update the preset settings and model preferences."}
            </DialogDescription>
          </DialogHeader>
          {editingPreset && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-preset-name">Preset Name</Label>
                <Input
                  id="edit-preset-name"
                  value={editingPreset.name}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, name: e.target.value })
                  }
                  disabled={editingPreset.isBuiltIn}
                />
              </div>
              <div>
                <Label htmlFor="edit-preset-url">API Base URL</Label>
                <Input
                  id="edit-preset-url"
                  type="url"
                  value={editingPreset.baseUrl}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, baseUrl: e.target.value })
                  }
                  disabled={editingPreset.isBuiltIn}
                />
              </div>
              <div>
                <Label htmlFor="edit-preset-key">API Key</Label>
                <Input
                  id="edit-preset-key"
                  type="password"
                  value={editingPreset.apiKey}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, apiKey: e.target.value })
                  }
                  placeholder="sk-..."
                />
              </div>

              {/* Model Preferences Section */}
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Model Preferences</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Optionally set default models for this preset. When switching to this preset, these models will be selected automatically.
                </p>

                <div className="space-y-4">
                  <PresetModelSelector
                    presetId={editingPreset.id}
                    baseUrl={editingPreset.baseUrl}
                    apiKey={editingPreset.apiKey}
                    value={editingPreset.mcpToolsModel || ""}
                    onValueChange={(value) =>
                      setEditingPreset({ ...editingPreset, mcpToolsModel: value })
                    }
                    label="Agent/MCP Tools Model"
                    placeholder="Select model for agent mode"
                  />

                  <PresetModelSelector
                    presetId={editingPreset.id}
                    baseUrl={editingPreset.baseUrl}
                    apiKey={editingPreset.apiKey}
                    value={editingPreset.transcriptProcessingModel || ""}
                    onValueChange={(value) =>
                      setEditingPreset({ ...editingPreset, transcriptProcessingModel: value })
                    }
                    label="Transcript Processing Model"
                    placeholder="Select model for transcripts"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdatePreset} disabled={saveConfigMutation.isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

