import React, { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent } from "./ui/card"
import { Button } from "./ui/button"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { useConversationHistoryQuery } from "@renderer/lib/query-client"
import { useConversationActions } from "@renderer/contexts/conversation-context"
import { cn } from "@renderer/lib/utils"

interface ConversationSwitcherPanelProps {
  onSelect: () => void
  onCancel: () => void
}

export function ConversationSwitcherPanel({ onSelect, onCancel }: ConversationSwitcherPanelProps) {
  const { data: history = [] } = useConversationHistoryQuery()
  const { continueConversation, endConversation } = useConversationActions()

  const [highlightIndex, setHighlightIndex] = useState(0)
  const items = useMemo(() => {
    // Build items with a synthetic "New Conversation" option at top
    const list = history.slice(0, 9) // show up to 9 existing items for number hotkeys
    return [{ id: "__new__", title: "New Conversation", preview: "Start fresh", updatedAt: 0 }, ...list]
  }, [history])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Stop keystrokes from reaching the underlying app
      e.stopPropagation()

      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        const item = items[highlightIndex]
        if (!item) return
        if (item.id === "__new__") {
          endConversation()
        } else {
          continueConversation(item.id)
        }
        onSelect()
        return
      }

      // Arrow navigation
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIndex((i) => (i + 1) % items.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIndex((i) => (i - 1 + items.length) % items.length)
        return
      }

      // Tab navigation
      if (e.key === "Tab") {
        e.preventDefault()
        const delta = e.shiftKey ? -1 : 1
        setHighlightIndex((i) => (i + delta + items.length) % items.length)
        return
      }

      // Number keys 0..9
      if (/^\d$/.test(e.key)) {
        e.preventDefault()
        const n = parseInt(e.key, 10)
        // 0 selects New Conversation, 1..9 selects list[0..8]
        const idx = n === 0 ? 0 : Math.min(n, items.length - 1)
        const item = items[idx]
        if (!item) return
        if (item.id === "__new__") {
          endConversation()
        } else {
          continueConversation(item.id)
        }
        onSelect()
        return
      }

      // Letter N for new conversation
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        endConversation()
        onSelect()
        return
      }
    }

    // Capture on window to ensure we intercept
    window.addEventListener("keydown", handler, true)
    return () => {
      window.removeEventListener("keydown", handler, true)
    }
  }, [items, highlightIndex, onSelect, onCancel, continueConversation, endConversation])

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      <div className="p-2 pb-0 text-sm text-muted-foreground">
        Use ↑/↓ or Tab to navigate · Enter to select · 1–9 to pick · 0/N for new · Esc to cancel
      </div>
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2">
          {items.map((item, idx) => (
            <Card
              key={item.id}
              className={cn(
                "cursor-pointer transition-colors",
                idx === highlightIndex ? "ring-2 ring-primary" : "hover:bg-accent/50",
              )}
              onMouseEnter={() => setHighlightIndex(idx)}
              onClick={() => {
                if (item.id === "__new__") endConversation()
                else continueConversation(item.id)
                onSelect()
              }}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 shrink-0 text-xs text-muted-foreground">
                    {idx === 0 ? 0 : idx}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.title}</div>
                    {item.preview && (
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {item.preview}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

