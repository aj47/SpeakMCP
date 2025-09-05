import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WebDebugApp } from './components/WebDebugApp'

// Initialize mock Electron environment before importing any components
import { initializeMockElectron } from './mocks/electron-mocks'
initializeMockElectron()

// Import the main app's CSS styles
import '../renderer/src/css/tailwind.css'
import './styles.css'

// Create QueryClient for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WebDebugApp />
    </QueryClientProvider>
  </React.StrictMode>
)
