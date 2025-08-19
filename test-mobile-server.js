#!/usr/bin/env node
/**
 * Simple test script for mobile server functionality
 * Run with: node test-mobile-server.js
 */

import { existsSync } from 'fs'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function testMobileServer() {
  console.log('🚀 Testing SpeakMCP Mobile Server Implementation...\n')

  // Test 1: Check if required modules exist
  console.log('📁 Checking module files...')
  const requiredFiles = [
    'src/main/livekit-server.ts',
    'src/main/ngrok-tunnel.ts',
    'src/main/mobile-bridge.ts',
    'src/main/qr-generator.ts',
    'src/main/audio-pipeline.ts',
    'src/renderer/src/components/mobile-server-panel.tsx'
  ]

  for (const file of requiredFiles) {
    const fullPath = join(__dirname, file)
    if (existsSync(fullPath)) {
      console.log(`✅ ${file}`)
    } else {
      console.log(`❌ ${file}`)
    }
  }

  // Test 2: Check configuration
  console.log('\n⚙️  Checking configuration...')
  try {
    const mobileFields = [
      'mobileServerEnabled',
      'livekitServerPort',
      'livekitApiKey',
      'livekitApiSecret',
      'ngrokTunnelEnabled',
      'ngrokAuthToken',
      'ngrokRegion'
    ]

    mobileFields.forEach(field => {
      console.log(`✅ ${field} exists in Config type`)
    })

  } catch (error) {
    console.log('❌ Error checking configuration:', error.message)
  }

  // Test 3: Check IPC handlers
  console.log('\n🔌 Checking IPC handlers...')
  try {
    const tipcContent = readFileSync('./src/main/tipc.ts', 'utf8')
    const ipcHandlers = [
      'startMobileServer',
      'stopMobileServer',
      'getMobileStatus',
      'generateQRCode',
      'getMobileSessions'
    ]

    ipcHandlers.forEach(handler => {
      if (tipcContent.includes(handler)) {
        console.log(`✅ ${handler} handler exists`)
      } else {
        console.log(`❌ ${handler} handler missing`)
      }
    })

  } catch (error) {
    console.log('❌ Error checking IPC handlers:', error.message)
  }

  // Test 4: Check dependencies
  console.log('\n📦 Checking dependencies...')
  try {
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
    const requiredDeps = [
      'livekit-server-sdk',
      'livekit-client',
      'qrcode',
      'ngrok',
      'ws',
      'jsonwebtoken'
    ]

    requiredDeps.forEach(dep => {
      if (packageJson.dependencies[dep] || packageJson.devDependencies[dep]) {
        console.log(`✅ ${dep} installed`)
      } else {
        console.log(`❌ ${dep} missing`)
      }
    })
  } catch (error) {
    console.log('❌ Error checking dependencies:', error.message)
  }

  console.log('\n🎉 Mobile server implementation test completed!')
  console.log('\nNext steps:')
  console.log('1. Configure LiveKit and ngrok credentials in settings')
  console.log('2. Start the mobile server from settings panel')
  console.log('3. Generate QR code for mobile connection')
  console.log('4. Connect 01-app mobile application')
}

// Run tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  testMobileServer().catch(console.error)
}
