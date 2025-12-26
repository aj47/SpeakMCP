// Helper function to format tool arguments for preview
export const formatArgumentsPreview = (args: any): string => {
  if (!args || typeof args !== 'object') return ''
  const entries = Object.entries(args)
  if (entries.length === 0) return ''

  // Take first 3 key parameters
  const preview = entries.slice(0, 3).map(([key, value]) => {
    let displayValue: string
    if (typeof value === 'string') {
      displayValue = value.length > 30 ? value.slice(0, 30) + '...' : value
    } else if (typeof value === 'object') {
      displayValue = Array.isArray(value) ? `[${value.length} items]` : '{...}'
    } else {
      displayValue = String(value)
    }
    return `${key}: ${displayValue}`
  }).join(', ')

  if (entries.length > 3) {
    return preview + ` (+${entries.length - 3} more)`
  }
  return preview
}
