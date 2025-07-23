import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { tv, type VariantProps } from "tailwind-variants"

import { cn } from "~/lib/utils"

const buttonVariants = tv({
  base: "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      default: "liquid-glass-button text-foreground shadow-lg hover:shadow-xl",
      destructive:
        "liquid-glass-button text-destructive-foreground bg-destructive/20 border-destructive/30 hover:bg-destructive/30",
      outline:
        "liquid-glass-button border glass-border hover:glass-bg-medium",
      secondary: "liquid-glass-subtle text-secondary-foreground hover:liquid-glass",
      ghost:
        "hover:liquid-glass-subtle hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
      glass: "liquid-glass-button liquid-glass-shine text-foreground",
      "glass-strong": "liquid-glass-strong liquid-glass-shine text-foreground",
    },
    size: {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-10 rounded-md px-8",
      icon: "h-8 w-8",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
