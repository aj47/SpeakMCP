import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@renderer/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "liquid-glass-subtle glass-border text-foreground hover:liquid-glass",
        secondary:
          "liquid-glass-subtle glass-border text-secondary-foreground hover:liquid-glass",
        destructive:
          "liquid-glass-subtle border-destructive/30 bg-destructive/20 text-destructive-foreground hover:bg-destructive/30",
        outline: "glass-border text-foreground hover:liquid-glass-subtle",
        glass: "liquid-glass glass-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
