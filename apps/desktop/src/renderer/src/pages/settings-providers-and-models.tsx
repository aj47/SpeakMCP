import React from "react"

// Compose the existing Providers and Models settings into a single view
import { Component as ProvidersSettings } from "./settings-providers"
import { Component as ModelsSettings } from "./settings-models"

export function Component() {
  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <div className="space-y-8">
        {/* Providers section */}
        <div>
          <ProvidersSettings />
        </div>
        {/* Models section */}
        <div>
          <ModelsSettings />
        </div>
      </div>
    </div>
  )
}

