import { systemPreferences } from "electron"

export const isAccessibilityGranted = () => {
  if (process.platform === "win32") return true

  return systemPreferences.isTrustedAccessibilityClient(false)
}
