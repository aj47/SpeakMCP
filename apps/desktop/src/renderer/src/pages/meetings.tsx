import React, { useState, useEffect, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import {
  Mic,
  MicOff,
  Monitor,
  Play,
  Square,
  Trash2,
  Calendar,
  Clock,
  FileText,
  ChevronDown,
  Edit2,
  Check,
  X,
  AlertCircle,
} from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"
import { toast } from "sonner"
import dayjs from "dayjs"
import type { Meeting, MeetingListItem, MeetingAudioSource, MeetingRecordingState } from "@shared/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"

type AudioSourceOption = {
  id: MeetingAudioSource
  label: string
  description: string
  icon: React.ReactNode
}

const AUDIO_SOURCE_OPTIONS: AudioSourceOption[] = [
  {
    id: "both",
    label: "Both",
    description: "Microphone + System Audio",
    icon: <><Mic className="h-4 w-4" /><Monitor className="h-4 w-4" /></>,
  },
  {
    id: "microphone",
    label: "Microphone",
    description: "Your voice only",
    icon: <Mic className="h-4 w-4" />,
  },
  {
    id: "system",
    label: "System Audio",
    description: "Desktop audio only",
    icon: <Monitor className="h-4 w-4" />,
  },
]

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function RecordingControls({
  recordingState,
  onStart,
  onStop,
  isStarting,
  isStopping,
}: {
  recordingState: MeetingRecordingState | null
  onStart: (audioSource: MeetingAudioSource) => void
  onStop: () => void
  isStarting: boolean
  isStopping: boolean
}) {
  const [selectedSource, setSelectedSource] = useState<MeetingAudioSource>("both")
  const [elapsedTime, setElapsedTime] = useState(0)

  const isRecording = recordingState?.isRecording ?? false

  // Timer for elapsed time
  useEffect(() => {
    if (!isRecording || !recordingState?.startedAt) {
      setElapsedTime(0)
      return undefined
    }

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - recordingState.startedAt!)
    }, 1000)

    return () => clearInterval(interval)
  }, [isRecording, recordingState?.startedAt])

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isRecording ? (
            <>
              <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              Recording Meeting
            </>
          ) : (
            <>
              <Mic className="h-5 w-5" />
              New Meeting Recording
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isRecording ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Audio Source</label>
              <div className="flex gap-2">
                {AUDIO_SOURCE_OPTIONS.map((option) => (
                  <Button
                    key={option.id}
                    variant={selectedSource === option.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSource(option.id)}
                    className="flex-1 flex-col h-auto py-3"
                  >
                    <div className="flex gap-1 mb-1">{option.icon}</div>
                    <span className="text-xs">{option.label}</span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {AUDIO_SOURCE_OPTIONS.find((o) => o.id === selectedSource)?.description}
              </p>
            </div>

            <Button
              onClick={() => onStart(selectedSource)}
              disabled={isStarting}
              className="w-full gap-2"
              size="lg"
            >
              {isStarting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Start Recording
                </>
              )}
            </Button>

            {process.platform !== "darwin" && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Meeting transcription is only available on macOS</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-mono font-bold">
                  {formatDuration(elapsedTime)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {AUDIO_SOURCE_OPTIONS.find((o) => o.id === recordingState?.audioSource)?.label || "Recording"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={onStop}
                  disabled={isStopping}
                  className="gap-2"
                >
                  {isStopping ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Stopping...
                    </>
                  ) : (
                    <>
                      <Square className="h-4 w-4" />
                      Stop
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Audio is being transcribed in real-time every 30 seconds
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MeetingCard({
  meeting,
  onOpen,
  onDelete,
  onRename,
}: {
  meeting: MeetingListItem
  onOpen: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(meeting.title)

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== meeting.title) {
      onRename(editTitle.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveTitle()
    } else if (e.key === "Escape") {
      setEditTitle(meeting.title)
      setIsEditing(false)
    }
  }

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
        meeting.status === "recording" && "border-red-500",
      )}
      onClick={() => !isEditing && onOpen()}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="h-7"
                />
                <Button size="sm" variant="ghost" onClick={handleSaveTitle} className="h-7 w-7 p-0">
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditTitle(meeting.title)
                    setIsEditing(false)
                  }}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <h3 className="mb-1 truncate font-medium flex items-center gap-2">
                {meeting.title}
                {meeting.status === "recording" && (
                  <Badge variant="destructive" className="text-xs">
                    Recording
                  </Badge>
                )}
              </h3>
            )}
            {meeting.previewText && (
              <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                {meeting.previewText}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs gap-1">
                <FileText className="h-3 w-3" />
                {meeting.segmentCount} segments
              </Badge>
              {meeting.duration && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(meeting.duration)}
                  </span>
                </>
              )}
              <span>•</span>
              <span>{dayjs(meeting.createdAt).format("MMM D, h:mm A")}</span>
            </div>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-8 w-8 p-0"
              title="Rename meeting"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
              title="Delete meeting"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MeetingDetail({
  meeting,
  onClose,
}: {
  meeting: Meeting
  onClose: () => void
}) {
  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{meeting.title}</DialogTitle>
          <DialogDescription>
            {dayjs(meeting.createdAt).format("MMMM D, YYYY h:mm A")}
            {meeting.duration && ` • ${formatDuration(meeting.duration)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {meeting.fullTranscript ? (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Full Transcript</h4>
                <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap">
                  {meeting.fullTranscript}
                </div>
              </div>

              {meeting.transcriptSegments.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Segments ({meeting.transcriptSegments.length})</h4>
                  <div className="space-y-2">
                    {meeting.transcriptSegments.map((segment) => (
                      <div key={segment.id} className="border rounded-md p-3">
                        <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {segment.source === "microphone" ? (
                              <Mic className="h-3 w-3 mr-1" />
                            ) : (
                              <Monitor className="h-3 w-3 mr-1" />
                            )}
                            {segment.source}
                          </Badge>
                          <span>{dayjs(segment.timestamp).format("h:mm:ss A")}</span>
                        </div>
                        <p className="text-sm">{segment.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No transcript available
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Component() {
  const queryClient = useQueryClient()
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)

  // Query recording state
  const recordingStateQuery = useQuery({
    queryKey: ["meetingRecordingState"],
    queryFn: () => tipcClient.getMeetingRecordingState(),
    refetchInterval: 1000, // Poll every second during recording
  })

  // Query meetings list
  const meetingsQuery = useQuery({
    queryKey: ["meetings"],
    queryFn: () => tipcClient.listMeetings(),
  })

  // Query selected meeting detail
  const meetingDetailQuery = useQuery({
    queryKey: ["meeting", selectedMeetingId],
    queryFn: () => selectedMeetingId ? tipcClient.getMeeting({ meetingId: selectedMeetingId }) : null,
    enabled: !!selectedMeetingId,
  })

  // Mutations
  const startMutation = useMutation({
    mutationFn: (audioSource: MeetingAudioSource) =>
      tipcClient.startMeetingRecording({ audioSource }),
    onSuccess: () => {
      toast.success("Recording started")
      queryClient.invalidateQueries({ queryKey: ["meetingRecordingState"] })
      queryClient.invalidateQueries({ queryKey: ["meetings"] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to start recording: ${error.message}`)
    },
  })

  const stopMutation = useMutation({
    mutationFn: () => tipcClient.stopMeetingRecording(),
    onSuccess: () => {
      toast.success("Recording stopped and transcription saved")
      queryClient.invalidateQueries({ queryKey: ["meetingRecordingState"] })
      queryClient.invalidateQueries({ queryKey: ["meetings"] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop recording: ${error.message}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (meetingId: string) => tipcClient.deleteMeeting({ meetingId }),
    onSuccess: () => {
      toast.success("Meeting deleted")
      queryClient.invalidateQueries({ queryKey: ["meetings"] })
    },
    onError: () => {
      toast.error("Failed to delete meeting")
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ meetingId, title }: { meetingId: string; title: string }) =>
      tipcClient.updateMeetingTitle({ meetingId, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] })
    },
    onError: () => {
      toast.error("Failed to rename meeting")
    },
  })

  // Group meetings by date
  const groupedMeetings = useMemo(() => {
    if (!meetingsQuery.data) return []

    const groups = new Map<string, MeetingListItem[]>()
    const today = dayjs().format("YYYY-MM-DD")
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    for (const meeting of meetingsQuery.data) {
      const date = dayjs(meeting.createdAt).format("YYYY-MM-DD")
      let groupKey: string

      if (date === today) {
        groupKey = "Today"
      } else if (date === yesterday) {
        groupKey = "Yesterday"
      } else {
        groupKey = dayjs(meeting.createdAt).format("MMM D, YYYY")
      }

      const items = groups.get(groupKey) || []
      items.push(meeting)
      groups.set(groupKey, items)
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.createdAt - a.createdAt),
    }))
  }, [meetingsQuery.data])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {/* Recording Controls */}
          <RecordingControls
            recordingState={recordingStateQuery.data ?? null}
            onStart={(audioSource) => startMutation.mutate(audioSource)}
            onStop={() => stopMutation.mutate()}
            isStarting={startMutation.isPending}
            isStopping={stopMutation.isPending}
          />

          {/* Meetings List */}
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Meeting History
              {meetingsQuery.data && (
                <Badge variant="secondary">{meetingsQuery.data.length}</Badge>
              )}
            </h2>

            {meetingsQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading meetings...
              </div>
            ) : groupedMeetings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No meetings recorded yet. Start your first recording above!
              </div>
            ) : (
              <div className="space-y-6">
                {groupedMeetings.map(({ date, items }) => (
                  <div key={date}>
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {date}
                    </h4>
                    <div className="space-y-2">
                      {items.map((meeting) => (
                        <MeetingCard
                          key={meeting.id}
                          meeting={meeting}
                          onOpen={() => setSelectedMeetingId(meeting.id)}
                          onDelete={() => deleteMutation.mutate(meeting.id)}
                          onRename={(title) =>
                            renameMutation.mutate({ meetingId: meeting.id, title })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Meeting Detail Dialog */}
      {selectedMeetingId && meetingDetailQuery.data && (
        <MeetingDetail
          meeting={meetingDetailQuery.data}
          onClose={() => setSelectedMeetingId(null)}
        />
      )}
    </div>
  )
}
