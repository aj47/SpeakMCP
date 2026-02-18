import { useState } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { Textarea } from "@renderer/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Trash2, Plus, Edit2, Save, X, Play, Clock } from "lucide-react"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery } from "@tanstack/react-query"
import { LoopConfig, Profile } from "@shared/types"
import { toast } from "sonner"

interface EditingLoop {
  id?: string
  name: string
  prompt: string
  intervalMinutes: number
  enabled: boolean
  profileId?: string
  runOnStartup: boolean
}

interface LoopRuntimeStatus {
  id: string
  isRunning: boolean
  nextRunAt?: number
  lastRunAt?: number
}

const emptyLoop: EditingLoop = {
  name: "",
  prompt: "",
  intervalMinutes: 15,
  enabled: true,
  runOnStartup: false,
}

const INTERVAL_PRESETS = [
  { label: "5 minutes", value: 5 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1440 },
]

function formatLastRun(timestamp?: number): string {
  if (!timestamp) return "Never"
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    if (remainingMinutes === 0) return `${hours}h`
    return `${hours}h ${remainingMinutes}m`
  }
  const days = Math.floor(minutes / 1440)
  const remainingMinutes = minutes % 1440
  if (remainingMinutes === 0) return `${days}d`
  const hours = Math.floor(remainingMinutes / 60)
  const mins = remainingMinutes % 60
  if (hours === 0) return `${days}d ${mins}m`
  if (mins === 0) return `${days}d ${hours}h`
  return `${days}d ${hours}h ${mins}m`
}

export function SettingsLoops() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const [editing, setEditing] = useState<EditingLoop | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => tipcClient.getProfiles() as Promise<Profile[]>,
  })
  const loopStatusesQuery = useQuery({
    queryKey: ["loop-statuses"],
    queryFn: async () => tipcClient.getLoopStatuses() as Promise<LoopRuntimeStatus[]>,
    refetchInterval: 5000,
  })

  const loops: LoopConfig[] = configQuery.data?.loops || []
  const profiles: Profile[] = profilesQuery.data || []
  const statusByLoopId = new Map(
    (loopStatusesQuery.data || []).map((s) => [s.id, s] as const)
  )
  const getConfigWithLoops = (updatedLoops: LoopConfig[]) => {
    if (!configQuery.data) {
      return null
    }
    return { ...configQuery.data, loops: updatedLoops }
  }

  const handleCreate = () => {
    setIsCreating(true)
    setEditing({ ...emptyLoop })
  }

  const handleCancel = () => {
    setEditing(null)
    setIsCreating(false)
  }

  const handleEdit = (loop: LoopConfig) => {
    setIsCreating(false)
    setEditing({
      id: loop.id,
      name: loop.name,
      prompt: loop.prompt,
      intervalMinutes: loop.intervalMinutes,
      enabled: loop.enabled,
      profileId: loop.profileId,
      runOnStartup: loop.runOnStartup ?? false,
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this loop?")) return
    const updatedLoops = loops.filter((l) => l.id !== id)
    const nextConfig = getConfigWithLoops(updatedLoops)
    if (!nextConfig) {
      toast.error("Configuration is still loading. Please try again.")
      return
    }
    await saveConfigMutation.mutateAsync({ config: nextConfig })
    // Stop the loop if it was running
    try {
      await tipcClient.stopLoop?.({ loopId: id })
    } catch {
      // Handler may not exist yet
    }
    toast.success("Loop deleted")
  }

  const handleSave = async () => {
    if (!editing || !editing.name.trim() || !editing.prompt.trim()) {
      toast.error("Name and prompt are required")
      return
    }

    const sanitizedIntervalMinutes = Number.isFinite(editing.intervalMinutes) && editing.intervalMinutes >= 1
      ? Math.floor(editing.intervalMinutes)
      : 1
    const loopData: LoopConfig = {
      id: editing.id || crypto.randomUUID(),
      name: editing.name.trim(),
      prompt: editing.prompt.trim(),
      intervalMinutes: sanitizedIntervalMinutes,
      enabled: editing.enabled,
      profileId: editing.profileId || undefined,
      runOnStartup: editing.runOnStartup,
    }

    let updatedLoops: LoopConfig[]
    if (isCreating) {
      updatedLoops = [...loops, loopData]
    } else {
      updatedLoops = loops.map((l) => (l.id === loopData.id ? loopData : l))
    }

    const nextConfig = getConfigWithLoops(updatedLoops)
    if (!nextConfig) {
      toast.error("Configuration is still loading. Please try again.")
      return
    }
    await saveConfigMutation.mutateAsync({ config: nextConfig })
    setEditing(null)
    setIsCreating(false)
    toast.success(isCreating ? "Loop created" : "Loop updated")

    // Start/stop loop based on enabled state
    try {
      if (loopData.enabled) {
        const result = await tipcClient.startLoop?.({ loopId: loopData.id })
        if (result && !result.success) {
          toast.error("Loop was saved but could not be started")
        }
      } else {
        const result = await tipcClient.stopLoop?.({ loopId: loopData.id })
        if (result && !result.success) {
          toast.error("Loop was saved but could not be stopped")
        }
      }
    } catch {
      // Handler may not exist yet
    }
  }

  const handleToggleEnabled = async (loop: LoopConfig) => {
    const updatedLoop = { ...loop, enabled: !loop.enabled }
    const updatedLoops = loops.map((l) => (l.id === loop.id ? updatedLoop : l))
    const nextConfig = getConfigWithLoops(updatedLoops)
    if (!nextConfig) {
      toast.error("Configuration is still loading. Please try again.")
      return
    }
    await saveConfigMutation.mutateAsync({ config: nextConfig })

    try {
      if (updatedLoop.enabled) {
        const result = await tipcClient.startLoop?.({ loopId: loop.id })
        if (result && !result.success) {
          toast.error("Loop enabled in settings, but runtime start failed")
          return
        }
      } else {
        const result = await tipcClient.stopLoop?.({ loopId: loop.id })
        if (result && !result.success) {
          toast.error("Loop disabled in settings, but runtime stop failed")
          return
        }
      }
    } catch {
      // Handler may not exist yet
    }
    toast.success(updatedLoop.enabled ? "Loop enabled" : "Loop disabled")
  }

  const handleRunNow = async (loop: LoopConfig) => {
    try {
      const result = await tipcClient.triggerLoop?.({ loopId: loop.id })
      if (result && !result.success) {
        toast.error(`Could not trigger "${loop.name}" right now`)
        return
      }
      toast.success(`Running "${loop.name}"...`)
    } catch {
      toast.error("Failed to trigger loop")
    }
  }

  const renderLoopList = () => (
    <div className="space-y-4">
      {loops.map((loop) => {
        const runtime = statusByLoopId.get(loop.id)
        const isRunning = runtime?.isRunning ?? false
        const nextRunAt = runtime?.nextRunAt
        const lastRunAt = runtime?.lastRunAt ?? loop.lastRunAt
        return (
        <Card key={loop.id} className={!loop.enabled ? "opacity-60" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg flex items-center gap-2">
                  {loop.name}
                  {isRunning ? (
                    <Badge variant="secondary">Running</Badge>
                  ) : loop.enabled ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </CardTitle>
                <CardDescription className="truncate max-w-md">
                  {loop.prompt}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleRunNow(loop)}>
                  <Play className="h-4 w-4 mr-1" />Run Now
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleEdit(loop)}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(loop.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Every {formatInterval(loop.intervalMinutes)}
              </div>
              {loop.profileId && (
                <div>Profile: {profiles.find(p => p.id === loop.profileId)?.name || loop.profileId}</div>
              )}
              {loop.runOnStartup && <Badge variant="secondary">Run on startup</Badge>}
              {typeof nextRunAt === "number" && (
                <div>Next run: {formatLastRun(nextRunAt)}</div>
              )}
              <div className="ml-auto">Last run: {formatLastRun(lastRunAt)}</div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Switch
                checked={loop.enabled}
                onCheckedChange={() => handleToggleEnabled(loop)}
              />
              <Label className="text-sm">{loop.enabled ? "Enabled" : "Disabled"}</Label>
            </div>
          </CardContent>
        </Card>
        )
      })}
      {loops.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No agent loops configured. Click "Add Loop" to create one.
        </div>
      )}
    </div>
  )

  const renderEditForm = () => {
    if (!editing) return null
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isCreating ? "Add Agent Loop" : "Edit Agent Loop"}</CardTitle>
          <CardDescription>
            Configure an agent to run automatically at regular intervals
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g., Daily Summary"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={editing.prompt}
              onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
              placeholder="Enter the prompt to send to the agent..."
              rows={4}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="interval">Interval</Label>
              <div className="flex gap-2">
                <Input
                  id="interval"
                  type="number"
                  min={1}
                  value={editing.intervalMinutes}
                  onChange={(e) => setEditing({ ...editing, intervalMinutes: parseInt(e.target.value) || 15 })}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground self-center">minutes</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {INTERVAL_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    variant={editing.intervalMinutes === preset.value ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setEditing({ ...editing, intervalMinutes: preset.value })}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile">Profile (Optional)</Label>
              <Select
                value={editing.profileId || "none"}
                onValueChange={(v) => setEditing({ ...editing, profileId: v === "none" ? undefined : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a profile..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Default Profile</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={editing.enabled}
                onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
              />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="runOnStartup"
                checked={editing.runOnStartup}
                onCheckedChange={(v) => setEditing({ ...editing, runOnStartup: v })}
              />
              <Label htmlFor="runOnStartup">Run on Startup</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agent Loops</h1>
          <p className="text-muted-foreground">
            Configure agents to run automatically at regular intervals
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />Add Loop
        </Button>
      </div>
      {editing ? renderEditForm() : renderLoopList()}
    </div>
  )
}

export { SettingsLoops as Component }
