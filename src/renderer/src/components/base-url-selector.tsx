import { useState, useEffect } from "react"
import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Button } from "@renderer/components/ui/button"
import { Plus, X } from "lucide-react"

interface BaseUrlSelectorProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  history?: string[]
  onHistoryUpdate?: (history: string[]) => void
  defaultUrls?: { label: string; value: string }[]
}

export function BaseUrlSelector({
  value = "",
  onChange,
  placeholder = "Enter base URL",
  history = [],
  onHistoryUpdate,
  defaultUrls = [],
}: BaseUrlSelectorProps) {
  const [isCustomInput, setIsCustomInput] = useState(false)
  const [customValue, setCustomValue] = useState("")

  // Check if current value is in predefined options
  const allOptions = [...defaultUrls, ...history.map(url => ({ label: url, value: url }))]
  const isValueInOptions = allOptions.some(option => option.value === value)

  useEffect(() => {
    if (!isValueInOptions && value) {
      setIsCustomInput(true)
      setCustomValue(value)
    }
  }, [value, isValueInOptions])

  const handleSelectChange = (selectedValue: string) => {
    if (selectedValue === "custom") {
      setIsCustomInput(true)
      setCustomValue(value)
    } else {
      setIsCustomInput(false)
      onChange(selectedValue)
    }
  }

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      onChange(customValue.trim())
      
      // Add to history if not already present and not a default URL
      const isDefault = defaultUrls.some(url => url.value === customValue.trim())
      if (!isDefault && !history.includes(customValue.trim()) && onHistoryUpdate) {
        const newHistory = [customValue.trim(), ...history].slice(0, 10) // Keep last 10
        onHistoryUpdate(newHistory)
      }
      
      setIsCustomInput(false)
    }
  }

  const handleCustomCancel = () => {
    setIsCustomInput(false)
    setCustomValue("")
    if (!value) {
      onChange("")
    }
  }

  const removeFromHistory = (urlToRemove: string) => {
    if (onHistoryUpdate) {
      const newHistory = history.filter(url => url !== urlToRemove)
      onHistoryUpdate(newHistory)
      
      // If the current value was removed, clear it
      if (value === urlToRemove) {
        onChange("")
      }
    }
  }

  if (isCustomInput) {
    return (
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder={placeholder}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleCustomSubmit()
            } else if (e.key === "Escape") {
              handleCustomCancel()
            }
          }}
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={handleCustomSubmit}
          disabled={!customValue.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCustomCancel}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <Select
      value={value || ""}
      onValueChange={handleSelectChange}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select or enter custom URL" />
      </SelectTrigger>
      <SelectContent>
        {/* Default URLs */}
        {defaultUrls.map((url) => (
          <SelectItem key={url.value} value={url.value}>
            {url.label}
          </SelectItem>
        ))}
        
        {/* History URLs */}
        {history.length > 0 && (
          <>
            {defaultUrls.length > 0 && (
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t">
                Recent URLs
              </div>
            )}
            {history.map((url) => (
              <div key={url} className="flex items-center justify-between px-2 py-1.5 hover:bg-accent">
                <SelectItem value={url} className="flex-1 border-none p-0">
                  <span className="truncate">{url}</span>
                </SelectItem>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFromHistory(url)
                  }}
                  className="h-6 w-6 p-0 ml-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </>
        )}
        
        {/* Custom option */}
        <div className="border-t">
          <SelectItem value="custom">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Enter custom URL
            </div>
          </SelectItem>
        </div>
      </SelectContent>
    </Select>
  )
}
