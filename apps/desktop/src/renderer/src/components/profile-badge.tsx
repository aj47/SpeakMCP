import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"
import { cn } from "@renderer/lib/utils"

interface ProfileBadgeProps {
  className?: string
}

/**
 * A small badge indicating that a setting is saved per-profile.
 * Displays a user icon with a tooltip explanation.
 */
export function ProfileBadge({ className }: ProfileBadgeProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary",
              "cursor-help",
              className
            )}
          >
            <span className="i-mingcute-user-3-line h-3 w-3" />
            <span>Profile</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p>This setting is saved per-profile. Switching profiles will change this value.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * A compact version of the profile badge (icon only) for tighter spaces.
 */
export function ProfileBadgeCompact({ className }: ProfileBadgeProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center justify-center rounded bg-primary/10 p-0.5",
              "cursor-help",
              className
            )}
          >
            <span className="i-mingcute-user-3-line h-3 w-3 text-primary" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p>This setting is saved per-profile. Switching profiles will change this value.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

