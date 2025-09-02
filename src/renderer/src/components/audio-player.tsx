import React, { useState, useRef, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Slider } from "@renderer/components/ui/slider"
import { Play, Pause, Volume2, VolumeX, Loader2 } from "lucide-react"
import { cn } from "@renderer/lib/utils"

interface AudioPlayerProps {
  audioData?: ArrayBuffer
  text: string
  onGenerateAudio?: () => Promise<ArrayBuffer>
  className?: string
  compact?: boolean
  isGenerating?: boolean
  error?: string | null
  autoPlay?: boolean
}

export function AudioPlayer({
  audioData,
  text,
  onGenerateAudio,
  className,
  compact = false,
  isGenerating = false,
  error = null,
  autoPlay = false,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [hasAudio, setHasAudio] = useState(!!audioData)
  const [hasAutoPlayed, setHasAutoPlayed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  // Create audio URL when audioData changes
  useEffect(() => {
    if (audioData) {
      // Clean up previous URL
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }

      // Create new URL
      const blob = new Blob([audioData], { type: "audio/wav" })
      audioUrlRef.current = URL.createObjectURL(blob)
      setHasAudio(true)
      setHasAutoPlayed(false) // Reset auto-play flag for new audio

      // Create audio element
      if (audioRef.current) {
        audioRef.current.src = audioUrlRef.current
      }
    }

    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }
    }
  }, [audioData])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    const handlePlay = () => {
      setIsPlaying(true)
    }

    const handlePause = () => {
      setIsPlaying(false)
    }

    const handleError = (event: Event) => {
      // Audio error occurred
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("play", handlePlay)
    audio.addEventListener("pause", handlePause)
    audio.addEventListener("error", handleError)

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("play", handlePlay)
      audio.removeEventListener("pause", handlePause)
      audio.removeEventListener("error", handleError)
    }
  }, [hasAudio])

  // Auto-play effect
  useEffect(() => {
    if (autoPlay && hasAudio && audioRef.current && !isPlaying && !hasAutoPlayed) {
      console.log("[AudioPlayer] Auto-playing audio")
      setHasAutoPlayed(true)
      audioRef.current.play().catch((error) => {
        console.error("[AudioPlayer] Auto-play failed:", error)
      })
    }
  }, [autoPlay, hasAudio, isPlaying, hasAutoPlayed])

  const handlePlayPause = async () => {
    if (!hasAudio && onGenerateAudio && !isGenerating && !error) {
      try {
        const generatedAudio = await onGenerateAudio()
        // audioData will be updated via props, which will trigger useEffect
      } catch (error) {
        // Error handling is done in the parent component
        return
      }
    }

    if (audioRef.current && hasAudio) {
      try {
        if (isPlaying) {
          audioRef.current.pause()
        } else {
          await audioRef.current.play()
        }
      } catch (playError) {
        // Audio playback failed, but we don't need to show an error
        // as the text is still available as fallback
      }
    }
  }

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0]
      setCurrentTime(value[0])
    }
  }

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0]
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
    setIsMuted(newVolume === 0)
  }

  const toggleMute = () => {
    if (audioRef.current) {
      if (isMuted) {
        audioRef.current.volume = volume
        setIsMuted(false)
      } else {
        audioRef.current.volume = 0
        setIsMuted(true)
      }
    }
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePlayPause}
          disabled={isGenerating}
          className="h-8 w-8 p-0"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        {hasAudio && duration > 0 && (
          <span className="text-xs text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        )}
        <audio ref={audioRef} />
      </div>
    )
  }

  return (
    <div className={cn("space-y-2 rounded-lg bg-muted/50 p-3", className)}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePlayPause}
          disabled={isGenerating}
          className="h-10 w-10 p-0"
        >
          {isGenerating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>

        <div className="flex-1 space-y-1">
          {hasAudio && duration > 0 ? (
            <>
              <Slider
                value={[currentTime]}
                max={duration}
                step={0.1}
                onValueChange={handleSeek}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {isGenerating ? "Generating audio..." : "Click play to generate audio"}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className="h-8 w-8 p-0"
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume]}
            max={1}
            step={0.1}
            onValueChange={handleVolumeChange}
            className="w-16"
          />
        </div>
      </div>

      <audio ref={audioRef} />
    </div>
  )
}
