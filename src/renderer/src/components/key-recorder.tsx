import React, { useState, useEffect, useCallback } from "react"
import { Button } from "./ui/button"
import { cn } from "@renderer/lib/utils"

interface KeyRecorderProps {
  value?: string
  onChange: (keyCombo: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

interface KeyState {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

const formatKeyCombo = (keyState: KeyState): string => {
  const parts: string[] = []

  if (keyState.ctrl) parts.push("Ctrl")
  if (keyState.shift) parts.push("Shift")
  if (keyState.alt) parts.push("Alt")
  if (keyState.meta) parts.push("Meta")

  if (
    keyState.key &&
    keyState.key !== "Control" &&
    keyState.key !== "Shift" &&
    keyState.key !== "Alt" &&
    keyState.key !== "Meta"
  ) {
    // Format special keys
    let displayKey = keyState.key
    if (keyState.key === " ") displayKey = "Space"
    else if (keyState.key === "ArrowUp") displayKey = "↑"
    else if (keyState.key === "ArrowDown") displayKey = "↓"
    else if (keyState.key === "ArrowLeft") displayKey = "←"
    else if (keyState.key === "ArrowRight") displayKey = "→"
    else if (keyState.key.length === 1) displayKey = keyState.key.toUpperCase()

    parts.push(displayKey)
  }

  return parts.join(" + ")
}

const keyComboToInternal = (keyState: KeyState): string => {
  const parts: string[] = []

  if (keyState.ctrl) parts.push("ctrl")
  if (keyState.shift) parts.push("shift")
  if (keyState.alt) parts.push("alt")
  if (keyState.meta) parts.push("meta")

  if (
    keyState.key &&
    keyState.key !== "Control" &&
    keyState.key !== "Shift" &&
    keyState.key !== "Alt" &&
    keyState.key !== "Meta"
  ) {
    let internalKey = keyState.key.toLowerCase()
    if (internalKey === " ") internalKey = "space"
    else if (internalKey === "arrowup") internalKey = "up"
    else if (internalKey === "arrowdown") internalKey = "down"
    else if (internalKey === "arrowleft") internalKey = "left"
    else if (internalKey === "arrowright") internalKey = "right"

    parts.push(internalKey)
  }

  return parts.join("-")
}

const internalToDisplay = (internal: string): string => {
  if (!internal) return ""

  const parts = internal.split("-")
  const displayParts: string[] = []

  for (const part of parts) {
    switch (part) {
      case "ctrl":
        displayParts.push("Ctrl")
        break
      case "shift":
        displayParts.push("Shift")
        break
      case "alt":
        displayParts.push("Alt")
        break
      case "meta":
        displayParts.push("Meta")
        break
      case "space":
        displayParts.push("Space")
        break
      case "up":
        displayParts.push("↑")
        break
      case "down":
        displayParts.push("↓")
        break
      case "left":
        displayParts.push("←")
        break
      case "right":
        displayParts.push("→")
        break
      default:
        displayParts.push(part.toUpperCase())
    }
  }

  return displayParts.join(" + ")
}

export function KeyRecorder({
  value,
  onChange,
  placeholder = "Click to record keys",
  className,
  disabled,
}: KeyRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedKeys, setRecordedKeys] = useState<KeyState>({
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: "",
  })

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return

      e.preventDefault()
      e.stopPropagation()

      // Don't record if only modifier keys are pressed
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        setRecordedKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          key: "",
        })
        return
      }

      // Record the full key combination
      const keyState: KeyState = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        key: e.key,
      }

      setRecordedKeys(keyState)

      // Auto-finish recording after capturing a key
      setTimeout(() => {
        const internalFormat = keyComboToInternal(keyState)
        onChange(internalFormat)
        setIsRecording(false)
      }, 100)
    },
    [isRecording, onChange],
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return
      e.preventDefault()
      e.stopPropagation()
    },
    [isRecording],
  )

  useEffect(() => {
    if (isRecording) {
      document.addEventListener("keydown", handleKeyDown, true)
      document.addEventListener("keyup", handleKeyUp, true)

      return () => {
        document.removeEventListener("keydown", handleKeyDown, true)
        document.removeEventListener("keyup", handleKeyUp, true)
      }
    }
    return undefined
  }, [isRecording, handleKeyDown, handleKeyUp])

  const startRecording = () => {
    if (disabled) return
    setIsRecording(true)
    setRecordedKeys({
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: "",
    })
  }

  const stopRecording = () => {
    setIsRecording(false)
  }

  const clearValue = () => {
    onChange("")
    setRecordedKeys({
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: "",
    })
  }

  const displayValue = value ? internalToDisplay(value) : ""
  const currentRecording = formatKeyCombo(recordedKeys)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1">
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !displayValue && !isRecording && "text-muted-foreground",
            isRecording && "border-blue-500 bg-blue-50 dark:bg-blue-950",
          )}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled}
        >
          {isRecording
            ? currentRecording || "Press keys..."
            : displayValue || placeholder}
        </Button>
      </div>

      {(displayValue || isRecording) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={isRecording ? stopRecording : clearValue}
          disabled={disabled}
          className="px-2"
        >
          {isRecording ? "Cancel" : "Clear"}
        </Button>
      )}
    </div>
  )
}
