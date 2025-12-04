import * as React from "react"

import { cn } from "~/lib/utils"
import { logUI, logFocus } from "@renderer/lib/debug"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<
  HTMLInputElement,
  InputProps & { wrapperClassName?: string; endContent?: React.ReactNode }
>(({ className, type, wrapperClassName, endContent, onFocus, onBlur, onChange, ...props }, ref) => {
  const internalRef = React.useRef<HTMLInputElement>(null)
  const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef

  // Track focus/blur at the input level
  const handleFocus = React.useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    logFocus('Input', 'focus', {
      placeholder: props.placeholder,
      value: e.target.value,
      activeElement: document.activeElement?.tagName
    })
    onFocus?.(e)
  }, [onFocus, props.placeholder])

  const handleBlur = React.useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    logFocus('Input', 'blur', {
      placeholder: props.placeholder,
      value: e.target.value,
      relatedTarget: e.relatedTarget?.tagName,
      activeElement: document.activeElement?.tagName
    })
    onBlur?.(e)
  }, [onBlur, props.placeholder])

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    logUI('[Input] onChange:', {
      placeholder: props.placeholder,
      value: e.target.value,
      activeElement: document.activeElement?.tagName,
      isFocused: document.activeElement === e.target
    })
    onChange?.(e)
  }, [onChange, props.placeholder])

  return (
    <div
      className={cn(
        "inline-flex h-7 w-full items-center rounded-md border border-input bg-background px-2 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-within:border-ring focus-within:outline-none focus-within:ring-1 focus-within:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        wrapperClassName,
      )}
    >
      <input
        type={type}
        className={cn("grow bg-transparent outline-none", className)}
        ref={inputRef}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        {...props}
      />

      {endContent}
    </div>
  )
})
Input.displayName = "Input"

export { Input }
