import React from 'react'
import { createRoot } from 'react-dom/client'
import { WebDebugApp } from './components/WebDebugApp'

// Initialize mock Electron environment before importing any components
import { initializeMockElectron } from './mocks/electron-mocks'
initializeMockElectron()

// Import the main app's CSS styles
import '../renderer/src/css/tailwind.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)
root.render(<WebDebugApp />)
