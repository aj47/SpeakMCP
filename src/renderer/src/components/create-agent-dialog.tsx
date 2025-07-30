import React, { useState } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Slider } from "@renderer/components/ui/slider"
import { Switch } from "@renderer/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@renderer/components/ui/select"
import { Plus, Bot, Settings, Zap } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

interface CreateAgentDialogProps {
  trigger?: React.ReactNode
  className?: string
  onAgentCreated?: (agentId: string) => void
}

interface AgentTemplate {
  id: string
  name: string
  description: string
  prompt: string
  maxIterations: number
  icon: React.ReactNode
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "general",
    name: "General Assistant",
    description: "A versatile agent for general tasks and questions",
    prompt: "You are a helpful AI assistant. Please help the user with their request using available tools when appropriate.",
    maxIterations: 10,
    icon: <Bot className="h-4 w-4" />
  },
  {
    id: "researcher",
    name: "Research Agent",
    description: "Specialized in research and information gathering",
    prompt: "You are a research specialist. Help the user gather comprehensive information on their topic using web search and other research tools. Provide well-structured, accurate information with sources.",
    maxIterations: 15,
    icon: <Settings className="h-4 w-4" />
  },
  {
    id: "coder",
    name: "Code Assistant",
    description: "Focused on programming and development tasks",
    prompt: "You are a programming assistant. Help the user with coding tasks, debugging, code review, and development questions. Use appropriate development tools and provide clear explanations.",
    maxIterations: 20,
    icon: <Zap className="h-4 w-4" />
  },
  {
    id: "analyzer",
    name: "Data Analyzer",
    description: "Specialized in data analysis and processing",
    prompt: "You are a data analysis specialist. Help the user analyze data, create visualizations, and extract insights. Use appropriate data processing tools and provide clear interpretations.",
    maxIterations: 12,
    icon: <Settings className="h-4 w-4" />
  }
]

export function CreateAgentDialog({ trigger, className, onAgentCreated }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string>("general")
  const [customPrompt, setCustomPrompt] = useState("")
  const [maxIterations, setMaxIterations] = useState([10])
  const [useCustomPrompt, setUseCustomPrompt] = useState(false)
  const [agentName, setAgentName] = useState("")
  const [autoStart, setAutoStart] = useState(true)

  const queryClient = useQueryClient()

  // Get current agent pool stats to check limits
  const statsQuery = useQuery({
    queryKey: ["agent-pool", "stats"],
    queryFn: () => tipcClient.getAgentPoolStats(),
    enabled: open
  })

  const createAgentMutation = useMutation({
    mutationFn: async (params: {
      prompt: string
      maxIterations: number
      metadata?: any
      autoStart?: boolean
    }) => {
      const agentId = await tipcClient.createAgent(params.prompt, {
        maxIterations: params.maxIterations,
        metadata: params.metadata
      })
      
      if (params.autoStart) {
        await tipcClient.startAgent(agentId)
      }
      
      return agentId
    },
    onSuccess: (agentId) => {
      toast.success("Agent created successfully!")
      queryClient.invalidateQueries({ queryKey: ["agent-pool"] })
      setOpen(false)
      resetForm()
      onAgentCreated?.(agentId)
    },
    onError: (error: any) => {
      toast.error(`Failed to create agent: ${error.message}`)
    }
  })

  const resetForm = () => {
    setSelectedTemplate("general")
    setCustomPrompt("")
    setMaxIterations([10])
    setUseCustomPrompt(false)
    setAgentName("")
    setAutoStart(true)
  }

  const handleSubmit = () => {
    const template = AGENT_TEMPLATES.find(t => t.id === selectedTemplate)
    const prompt = useCustomPrompt ? customPrompt : template?.prompt || ""
    
    if (!prompt.trim()) {
      toast.error("Please provide a prompt for the agent")
      return
    }

    const metadata = {
      templateId: selectedTemplate,
      templateName: template?.name,
      customName: agentName || template?.name,
      createdAt: Date.now()
    }

    createAgentMutation.mutate({
      prompt: prompt.trim(),
      maxIterations: maxIterations[0],
      metadata,
      autoStart
    })
  }

  const selectedTemplateData = AGENT_TEMPLATES.find(t => t.id === selectedTemplate)
  const canCreateAgent = !statsQuery.data || statsQuery.data.activeAgents < 5 // Assuming max 5 concurrent

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className={className}>
            <Plus className="h-4 w-4 mr-2" />
            Create Agent
          </Button>
        )}
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
          <DialogDescription>
            Configure and launch a new parallel agent with its own conversation thread.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Agent Limit Warning */}
          {!canCreateAgent && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                Maximum concurrent agents limit reached. Please wait for some agents to complete or stop them manually.
              </p>
            </div>
          )}

          {/* Agent Name */}
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent Name (Optional)</Label>
            <Input
              id="agent-name"
              placeholder="Custom name for this agent"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
            />
          </div>

          {/* Template Selection */}
          <div className="space-y-3">
            <Label>Agent Template</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AGENT_TEMPLATES.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    "p-3 border rounded-lg cursor-pointer transition-colors",
                    selectedTemplate === template.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => setSelectedTemplate(template.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">{template.icon}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm">{template.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {template.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Prompt Toggle */}
          <div className="flex items-center space-x-2">
            <Switch
              id="custom-prompt"
              checked={useCustomPrompt}
              onCheckedChange={setUseCustomPrompt}
            />
            <Label htmlFor="custom-prompt">Use custom prompt</Label>
          </div>

          {/* Prompt Display/Edit */}
          <div className="space-y-2">
            <Label>Agent Prompt</Label>
            {useCustomPrompt ? (
              <Textarea
                placeholder="Enter custom prompt for the agent..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={4}
              />
            ) : (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {selectedTemplateData?.prompt}
                </p>
              </div>
            )}
          </div>

          {/* Max Iterations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Maximum Iterations</Label>
              <span className="text-sm text-muted-foreground">
                {maxIterations[0]}
              </span>
            </div>
            <Slider
              value={maxIterations}
              onValueChange={setMaxIterations}
              max={50}
              min={1}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values allow more complex tasks but use more resources
            </p>
          </div>

          {/* Auto Start */}
          <div className="flex items-center space-x-2">
            <Switch
              id="auto-start"
              checked={autoStart}
              onCheckedChange={setAutoStart}
            />
            <Label htmlFor="auto-start">Start agent immediately</Label>
          </div>

          {/* Resource Usage Info */}
          {statsQuery.data && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Current Pool Status</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Active: </span>
                  <span className="font-medium">{statsQuery.data.activeAgents}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-medium">{statsQuery.data.totalAgents}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Completed: </span>
                  <span className="font-medium">{statsQuery.data.completedAgents}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Processes: </span>
                  <span className="font-medium">{statsQuery.data.totalResourceUsage.processes}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createAgentMutation.isPending || !canCreateAgent}
          >
            {createAgentMutation.isPending ? (
              "Creating..."
            ) : autoStart ? (
              "Create & Start Agent"
            ) : (
              "Create Agent"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
