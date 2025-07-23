import { Button } from "@renderer/components/ui/button"
import { Control, ControlGroup } from "@renderer/components/ui/control"
import { queryClient } from "@renderer/lib/query-client"
import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { RecordingHistoryItem } from "@shared/types"
import dayjs from "dayjs"
import { Input } from "@renderer/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import { playSound } from "@renderer/lib/sound"

export function Component() {
  const historyQuery = useQuery({
    queryKey: ["recording-history"],
    queryFn: async () => {
      return tipcClient.getRecordingHistory()
    },
  })

  const deleteRecordingHistoryMutation = useMutation({
    mutationFn: tipcClient.deleteRecordingHistory,
    onSuccess() {
      queryClient.invalidateQueries({
        queryKey: ["recording-history"],
      })
    },
  })

  const [keyword, setKeyword] = useState("")

  const today = useMemo(() => dayjs().format("MMM D, YYYY"), [])
  const yesterday = useMemo(
    () => dayjs().subtract(1, "day").format("MMM D, YYYY"),
    [],
  )

  const historyGroupsByDate = useMemo(() => {
    if (!historyQuery.data) return []

    const groups = new Map<string, RecordingHistoryItem[]>()

    for (const item of historyQuery.data) {
      if (
        keyword &&
        !item.transcript.toLowerCase().includes(keyword.toLowerCase())
      ) {
        continue
      }

      const date = dayjs(item.createdAt).format("MMM D, YYYY")

      const items = groups.get(date) || []

      items.push(item)
      groups.set(date, items)
    }

    return [...groups.entries()].map((entry) => {
      return {
        date: entry[0],
        items: entry[1],
      }
    })
  }, [historyQuery.data, keyword])

  useEffect(() => {
    return rendererHandlers.refreshRecordingHistory.listen(() => {
      queryClient.invalidateQueries({
        queryKey: ["recording-history"],
      })
    })
  }, [])

  return (
    <>
      <header className="app-drag-region flex h-12 shrink-0 items-center justify-between liquid-glass-nav glass-border-b glass-shine px-4 text-sm">
        <span className="font-bold">History</span>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="h-7 gap-1 px-2 py-0 text-red-500 hover:text-red-500"
            onClick={() => {
              if (
                window.confirm(
                  "Are you absolutely sure to remove all recordings forever?",
                )
              ) {
                deleteRecordingHistoryMutation.mutate()
              }
            }}
          >
            <span className="i-mingcute-delete-2-fill"></span>
            <span>Delete All</span>
          </Button>
          <Input
            wrapperClassName="liquid-glass-input glass-border glass-blur-light"
            endContent={
              <span className="i-mingcute-search-2-line text-muted-foreground"></span>
            }
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </header>

      {historyGroupsByDate.length === 0 ? (
        <div className="flex grow flex-col items-center justify-center gap-2 text-center font-semibold leading-none">
          <span className="mx-auto max-w-md text-2xl text-muted-foreground">
            No Recordings {keyword ? `For ${JSON.stringify(keyword)}` : ""}
          </span>
          {!keyword && (
            <span className="text-sm text-muted-foreground">
              Hold{" "}
              <span className="inline-flex h-6 items-center rounded-lg liquid-glass-interactive glass-border glass-shine p-1 text-sm">
                Ctrl
              </span>{" "}
              to record
            </span>
          )}
        </div>
      ) : (
        <div className="grow overflow-auto px-8 py-8">
          <div className="grid gap-5">
            {historyGroupsByDate.map((group) => {
              return (
                <ControlGroup
                  key={group.date}
                  variant="glass"
                  title={
                    group.date === today
                      ? "Today"
                      : group.date === yesterday
                        ? "Yesterday"
                        : group.date
                  }
                >
                  {group.items.map((item) => {
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-5 p-4 hover:liquid-glass-subtle transition-all duration-200 rounded-lg"
                      >
                        <TooltipProvider>
                          <Tooltip delayDuration={0} disableHoverableContent>
                            <TooltipTrigger asChild>
                              <span className="inline-flex h-5 shrink-0 cursor-default items-center justify-center rounded liquid-glass-subtle glass-border px-1 text-xs text-muted-foreground">
                                {dayjs(item.createdAt).format("HH:mm")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Recorded at{" "}
                              {dayjs(item.createdAt).format(
                                "ddd, MMM D, YYYY h:mm A",
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="grow select-text">
                          {item.transcript}
                        </div>
                        <div className="flex shrink-0 gap-2 text-sm">
                          <PlayButton id={item.id} />

                          <DeleteButton id={item.id} />
                        </div>
                      </div>
                    )
                  })}
                </ControlGroup>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

const itemButtonVariants = ({ isDanger }: { isDanger?: boolean } = {}) =>
  cn(
    "w-6 h-6 rounded-md inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-black dark:hover:text-white",

    isDanger && "hover:text-red-500 dark:hover:text-red-600",
  )

const PlayButton = ({ id }: { id: string }) => {
  const [status, setStatus] = useState<null | "playing" | "paused">(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const start = () => {
    const audio = (audioRef.current = new Audio())
    audio.src = `assets://recording/${id}`
    audio.addEventListener("play", () => {
      setStatus("playing")
    })
    audio.addEventListener("ended", () => {
      setStatus(null)
    })
    audio.addEventListener("pause", () => {
      setStatus("paused")
    })

    audio.play()
  }

  const pause = () => {
    audioRef.current?.pause()
  }

  return (
    <button
      type="button"
      className={itemButtonVariants()}
      onClick={() => {
        if (status === null) {
          start()
        } else if (status === "playing") {
          pause()
        } else if (status === "paused") {
          audioRef.current?.play()
        }
      }}
    >
      <span
        className={cn(
          status === "playing"
            ? "i-mingcute-pause-fill"
            : "i-mingcute-play-fill",
        )}
      ></span>
    </button>
  )
}

const DeleteButton = ({ id }: { id: string }) => {
  return (
    <button
      type="button"
      className={itemButtonVariants({ isDanger: true })}
      onClick={async () => {
        if (window.confirm("Delete this recording forever?")) {
          await tipcClient.deleteRecordingItem({ id })
          queryClient.invalidateQueries({
            queryKey: ["recording-history"],
          })
        }
      }}
    >
      <span className="i-mingcute-delete-2-fill"></span>
    </button>
  )
}
