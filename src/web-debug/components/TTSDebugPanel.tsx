import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../renderer/src/components/ui/card'
import { Button } from '../../renderer/src/components/ui/button'
import { Badge } from '../../renderer/src/components/ui/badge'
import { ScrollArea } from '../../renderer/src/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../renderer/src/components/ui/select'
import { Textarea } from '../../renderer/src/components/ui/textarea'
import { Input } from '../../renderer/src/components/ui/input'
import { Label } from '../../renderer/src/components/ui/label'
import { Switch } from '../../renderer/src/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../renderer/src/components/ui/tabs'
import { 
  Play, 
  Pause, 
  Square, 
  Volume2, 
  Settings, 
  Download, 
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Waveform
} from 'lucide-react'

interface TTSDebugRequest {
  id: string
  text: string
  provider: string
  voice?: string
  model?: string
  speed?: number
  timestamp: number
  sessionId?: string
}

interface TTSDebugResponse {
  id: string
  requestId: string
  success: boolean
  audioBuffer?: ArrayBuffer
  audioSize?: number
  duration: number
  provider: string
  processedText?: string
  error?: string
  timestamp: number
}

interface TTSPreprocessingResult {
  originalText: string
  processedText: string
  originalLength: number
  processedLength: number
  options: any
  issues: string[]
  isValid: boolean
}

interface TTSDebugPanelProps {
  onTTSGenerate?: (text: string, provider: string, options: any) => Promise<void>
  onScenarioRun?: (scenarioId: string) => Promise<void>
}

export const TTSDebugPanel: React.FC<TTSDebugPanelProps> = ({
  onTTSGenerate,
  onScenarioRun
}) => {
  const [requests, setRequests] = useState<TTSDebugRequest[]>([])
  const [responses, setResponses] = useState<TTSDebugResponse[]>([])
  const [preprocessingResults, setPreprocessingResults] = useState<TTSPreprocessingResult[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // TTS Configuration
  const [testText, setTestText] = useState('This is a test message for TTS debugging. It contains various elements like **bold text**, code blocks, and URLs like https://example.com to test preprocessing.')
  const [selectedProvider, setSelectedProvider] = useState<'openai' | 'groq' | 'gemini'>('openai')
  const [selectedVoice, setSelectedVoice] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [speed, setSpeed] = useState(1.0)
  const [enablePreprocessing, setEnablePreprocessing] = useState(true)

  // Preprocessing options
  const [removeCodeBlocks, setRemoveCodeBlocks] = useState(true)
  const [removeUrls, setRemoveUrls] = useState(true)
  const [convertMarkdown, setConvertMarkdown] = useState(true)
  const [maxLength, setMaxLength] = useState(4000)

  const voiceOptions = {
    openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    groq: ['Fritz-PlayAI', 'Deedee-PlayAI', 'Donna-PlayAI', 'Paige-PlayAI'],
    gemini: ['Kore', 'Charon', 'Fenrir', 'Aoede']
  }

  const modelOptions = {
    openai: ['tts-1', 'tts-1-hd'],
    groq: ['playai-tts'],
    gemini: ['gemini-2.5-flash-preview-tts']
  }

  useEffect(() => {
    // Set default voice and model when provider changes
    setSelectedVoice(voiceOptions[selectedProvider][0])
    setSelectedModel(modelOptions[selectedProvider][0])
  }, [selectedProvider])

  const handleTTSGenerate = async () => {
    if (!testText.trim() || !onTTSGenerate) return

    setIsGenerating(true)
    try {
      await onTTSGenerate(testText, selectedProvider, {
        voice: selectedVoice,
        model: selectedModel,
        speed,
        enablePreprocessing,
        preprocessingOptions: {
          removeCodeBlocks,
          removeUrls,
          convertMarkdown,
          maxLength
        }
      })
    } catch (error) {
      console.error('TTS generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const handlePlayAudio = (response: TTSDebugResponse) => {
    if (!response.audioBuffer) return

    if (currentAudio) {
      currentAudio.pause()
      setCurrentAudio(null)
      setIsPlaying(false)
    }

    const blob = new Blob([response.audioBuffer], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const audio = new HTMLAudioElement(url)
    
    audio.onplay = () => setIsPlaying(true)
    audio.onpause = () => setIsPlaying(false)
    audio.onended = () => {
      setIsPlaying(false)
      setCurrentAudio(null)
      URL.revokeObjectURL(url)
    }

    setCurrentAudio(audio)
    audio.play()
  }

  const handleStopAudio = () => {
    if (currentAudio) {
      currentAudio.pause()
      setCurrentAudio(null)
      setIsPlaying(false)
    }
  }

  const formatDuration = (ms: number) => {
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatFileSize = (bytes: number) => {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const getStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <AlertCircle className="h-4 w-4 text-red-500" />
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Waveform className="h-5 w-5" />
            TTS Debug Panel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="generator" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="generator">Generator</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="preprocessing">Preprocessing</TabsTrigger>
              <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            </TabsList>

            <TabsContent value="generator" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="test-text">Test Text</Label>
                  <Textarea
                    id="test-text"
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Enter text to convert to speech..."
                    className="min-h-[100px]"
                  />
                  <div className="text-sm text-muted-foreground mt-1">
                    {testText.length} characters
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="provider">Provider</Label>
                    <Select value={selectedProvider} onValueChange={(value: any) => setSelectedProvider(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="groq">Groq</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="voice">Voice</Label>
                    <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {voiceOptions[selectedProvider].map(voice => (
                          <SelectItem key={voice} value={voice}>{voice}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="model">Model</Label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions[selectedProvider].map(model => (
                          <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="speed">Speed</Label>
                    <Input
                      id="speed"
                      type="number"
                      min="0.25"
                      max="4.0"
                      step="0.25"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enable-preprocessing"
                      checked={enablePreprocessing}
                      onCheckedChange={setEnablePreprocessing}
                    />
                    <Label htmlFor="enable-preprocessing">Enable Preprocessing</Label>
                  </div>

                  {enablePreprocessing && (
                    <div className="ml-6 space-y-2">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="remove-code"
                          checked={removeCodeBlocks}
                          onCheckedChange={setRemoveCodeBlocks}
                        />
                        <Label htmlFor="remove-code">Remove Code Blocks</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="remove-urls"
                          checked={removeUrls}
                          onCheckedChange={setRemoveUrls}
                        />
                        <Label htmlFor="remove-urls">Remove URLs</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="convert-markdown"
                          checked={convertMarkdown}
                          onCheckedChange={setConvertMarkdown}
                        />
                        <Label htmlFor="convert-markdown">Convert Markdown</Label>
                      </div>
                      <div>
                        <Label htmlFor="max-length">Max Length</Label>
                        <Input
                          id="max-length"
                          type="number"
                          min="100"
                          max="10000"
                          value={maxLength}
                          onChange={(e) => setMaxLength(parseInt(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <Button 
                  onClick={handleTTSGenerate} 
                  disabled={isGenerating || !testText.trim()}
                  className="w-full"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Generate TTS
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">TTS Generation History</h3>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>

              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {responses.map((response) => (
                    <Card key={response.id} className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {getStatusIcon(response.success)}
                            <Badge variant="outline">{response.provider}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {new Date(response.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          
                          {response.success ? (
                            <div className="text-sm space-y-1">
                              <div>Duration: {formatDuration(response.duration)}</div>
                              {response.audioSize && (
                                <div>Size: {formatFileSize(response.audioSize)}</div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-red-600">
                              Error: {response.error}
                            </div>
                          )}
                        </div>

                        {response.success && response.audioBuffer && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePlayAudio(response)}
                              disabled={isPlaying}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            {isPlaying && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleStopAudio}
                              >
                                <Square className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}

                  {responses.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      No TTS generations yet. Use the Generator tab to create some.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="preprocessing" className="space-y-4">
              <h3 className="text-lg font-semibold">Text Preprocessing Results</h3>
              
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {preprocessingResults.map((result, index) => (
                    <Card key={index} className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant={result.isValid ? "default" : "destructive"}>
                            {result.isValid ? "Valid" : "Invalid"}
                          </Badge>
                          <div className="text-sm text-muted-foreground">
                            {result.originalLength} → {result.processedLength} chars
                            ({Math.round((1 - result.processedLength / result.originalLength) * 100)}% reduction)
                          </div>
                        </div>

                        {result.issues.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-red-600">Issues:</div>
                            <ul className="text-sm text-red-600 list-disc list-inside">
                              {result.issues.map((issue, i) => (
                                <li key={i}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-sm font-medium mb-1">Original Text</div>
                            <div className="text-xs bg-muted p-2 rounded max-h-20 overflow-y-auto">
                              {result.originalText.substring(0, 200)}
                              {result.originalText.length > 200 && '...'}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium mb-1">Processed Text</div>
                            <div className="text-xs bg-muted p-2 rounded max-h-20 overflow-y-auto">
                              {result.processedText.substring(0, 200)}
                              {result.processedText.length > 200 && '...'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}

                  {preprocessingResults.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      No preprocessing results yet. Enable preprocessing in the Generator tab.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="scenarios" className="space-y-4">
              <h3 className="text-lg font-semibold">Playwright TTS Scenarios</h3>
              
              <div className="grid gap-4">
                {[
                  { id: 'news-article-tts', name: 'News Article TTS', description: 'Extract and convert news article to speech' },
                  { id: 'documentation-tts', name: 'Technical Documentation', description: 'Handle code blocks and technical content' },
                  { id: 'search-results-tts', name: 'Search Results', description: 'Process mixed search result content' },
                  { id: 'form-interaction-tts', name: 'Form Interaction', description: 'TTS feedback for form submissions' },
                  { id: 'error-page-tts', name: 'Error Page Handling', description: 'Handle error pages and edge cases' }
                ].map((scenario) => (
                  <Card key={scenario.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">{scenario.name}</h4>
                        <p className="text-sm text-muted-foreground">{scenario.description}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => onScenarioRun?.(scenario.id)}
                      >
                        Run Scenario
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
