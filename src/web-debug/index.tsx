import React from 'react'
import { createRoot } from 'react-dom/client'
import { WebDebugApp } from './components/WebDebugApp'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)
root.render(<WebDebugApp />)
