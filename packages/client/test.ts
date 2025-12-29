/**
 * Simple test script for the SpeakMCP client SDK.
 * 
 * Usage:
 *   1. Start the server: cd packages/server && pnpm start
 *   2. Run this test: cd packages/client && npx tsx test.ts
 */

import { SpeakMcpClient } from './dist/index.js'

const API_KEY = 'test-api-key' // Replace with your actual API key
const BASE_URL = 'http://localhost:3847'

async function main() {
  const client = new SpeakMcpClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
  })

  console.log('=== SpeakMCP Client SDK Test ===\n')

  // 1. Health check
  console.log('1. Health Check')
  try {
    const connected = await client.isConnected()
    console.log(`   Connected: ${connected}`)
    if (!connected) {
      console.log('\n   Server not running. Start it with:')
      console.log('   cd packages/server && pnpm start')
      return
    }
    const health = await client.checkHealth()
    console.log(`   Status: ${health.status}`)
  } catch (e) {
    console.log(`   Error: ${e}`)
    return
  }

  // 2. Config
  console.log('\n2. Get Config')
  try {
    const { config } = await client.getConfig()
    console.log(`   Provider: ${config.mcpToolsProviderId || 'not set'}`)
    console.log(`   Model: ${config.mcpToolsOpenaiModel || 'not set'}`)
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 3. Profiles
  console.log('\n3. Profiles')
  try {
    const { profiles, currentProfileId } = await client.getProfiles()
    console.log(`   Total: ${profiles.length}`)
    console.log(`   Current: ${currentProfileId || 'none'}`)
    profiles.slice(0, 3).forEach(p => {
      console.log(`   - ${p.name} (${p.id})`)
    })
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 4. Conversations
  console.log('\n4. Conversations')
  try {
    const { conversations } = await client.getConversations()
    console.log(`   Total: ${conversations.length}`)
    conversations.slice(0, 3).forEach(c => {
      console.log(`   - ${c.title} (${c.messageCount} messages)`)
    })
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 5. MCP Servers
  console.log('\n5. MCP Servers')
  try {
    const { servers } = await client.getMcpServers()
    console.log(`   Total: ${servers.length}`)
    servers.slice(0, 5).forEach(s => {
      const status = s.connected ? '✓' : '✗'
      console.log(`   ${status} ${s.name} (${s.toolCount} tools)`)
    })
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 6. MCP Tools
  console.log('\n6. MCP Tools')
  try {
    const { tools } = await client.getMcpTools()
    console.log(`   Total: ${tools.length}`)
    tools.slice(0, 5).forEach(t => {
      console.log(`   - ${t.name} (${t.serverName})`)
    })
    if (tools.length > 5) {
      console.log(`   ... and ${tools.length - 5} more`)
    }
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 7. Models (OpenAI-compatible)
  console.log('\n7. Available Models')
  try {
    const { data: models } = await client.getModels()
    models.forEach(m => {
      console.log(`   - ${m.id} (${m.owned_by})`)
    })
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  // 8. Create and delete test conversation
  console.log('\n8. Create/Delete Conversation')
  try {
    const { conversation } = await client.createConversation({
      firstMessage: 'SDK test message',
    })
    console.log(`   Created: ${conversation.id}`)
    
    await client.deleteConversation(conversation.id)
    console.log(`   Deleted: ${conversation.id}`)
  } catch (e) {
    console.log(`   Error: ${e}`)
  }

  console.log('\n=== All tests completed ===')
}

main().catch(console.error)
