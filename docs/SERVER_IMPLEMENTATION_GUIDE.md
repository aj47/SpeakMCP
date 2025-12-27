# SpeakMCP Server Implementation Guide

This is a step-by-step guide for implementing the central server that will support multiple client interfaces. Follow each phase in order.

---

## Table of Contents

1. [Phase 0: Project Setup](#phase-0-project-setup)
2. [Phase 1: Database & Configuration](#phase-1-database--configuration)
3. [Phase 2: Authentication](#phase-2-authentication)
4. [Phase 3: Conversations (First Vertical Slice)](#phase-3-conversations-first-vertical-slice)
5. [Phase 4: Profiles Service](#phase-4-profiles-service)
6. [Phase 5: MCP Service](#phase-5-mcp-service)
7. [Phase 6: Agent Processing](#phase-6-agent-processing)
8. [Phase 7: Real-time Communication](#phase-7-real-time-communication)
9. [Phase 8: Speech Services](#phase-8-speech-services)
10. [Phase 9: Desktop Client Migration](#phase-9-desktop-client-migration)

---

## Phase 0: Project Setup

### 0.1 Create the Server Package

```bash
# From repository root
mkdir -p packages/server/src/{routes,services,db,middleware,utils}
cd packages/server
```

### 0.2 Initialize Package

Create `packages/server/package.json`:

```json
{
  "name": "@speakmcp/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/websocket": "^11.0.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "openai": "^4.0.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

### 0.3 TypeScript Configuration

Create `packages/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

### 0.4 Environment Configuration

Create `packages/server/.env.example`:

```env
# Server
PORT=3456
HOST=0.0.0.0

# Authentication
API_KEY=your-secret-api-key

# Database
DATABASE_PATH=./data/speakmcp.db

# LLM Providers (copied from user config on first run)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
GROQ_API_KEY=
GEMINI_API_KEY=
```

### 0.5 Bootstrap Server

Create `packages/server/src/index.ts`:

```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { initDatabase } from './db/index.js'
import { authMiddleware } from './middleware/auth.js'

// Routes
import { healthRoutes } from './routes/health.js'
import { configRoutes } from './routes/config.js'
import { conversationRoutes } from './routes/conversations.js'
import { profileRoutes } from './routes/profiles.js'
import { mcpRoutes } from './routes/mcp.js'
import { agentRoutes } from './routes/agent.js'
import { speechRoutes } from './routes/speech.js'

async function main() {
  const server = Fastify({ logger: true })

  // Plugins
  await server.register(cors, { origin: true })

  // Initialize database
  await initDatabase()

  // Auth middleware (skip for health check)
  server.addHook('onRequest', authMiddleware)

  // Register routes
  await server.register(healthRoutes, { prefix: '/api' })
  await server.register(configRoutes, { prefix: '/api' })
  await server.register(conversationRoutes, { prefix: '/api' })
  await server.register(profileRoutes, { prefix: '/api' })
  await server.register(mcpRoutes, { prefix: '/api' })
  await server.register(agentRoutes, { prefix: '/api' })
  await server.register(speechRoutes, { prefix: '/api' })

  // Start server
  await server.listen({ port: config.port, host: config.host })
  console.log(`Server running at http://${config.host}:${config.port}`)
}

main().catch(console.error)
```

### 0.6 Config Loader

Create `packages/server/src/config.ts`:

```typescript
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.string().default('3456').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  API_KEY: z.string().min(1),
  DATABASE_PATH: z.string().default('./data/speakmcp.db'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
})

const env = envSchema.parse(process.env)

export const config = {
  port: env.PORT,
  host: env.HOST,
  apiKey: env.API_KEY,
  databasePath: env.DATABASE_PATH,
  openai: {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
  },
}
```

### 0.7 Directory Structure

After Phase 0, you should have:

```
packages/server/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Environment config
│   ├── db/
│   │   └── index.ts      # Database initialization
│   ├── middleware/
│   │   └── auth.ts       # Authentication
│   ├── routes/
│   │   ├── health.ts
│   │   ├── config.ts
│   │   ├── conversations.ts
│   │   ├── profiles.ts
│   │   ├── mcp.ts
│   │   ├── agent.ts
│   │   └── speech.ts
│   ├── services/
│   │   ├── conversation.ts
│   │   ├── profile.ts
│   │   ├── mcp.ts
│   │   ├── agent.ts
│   │   └── llm.ts
│   └── utils/
│       └── errors.ts
├── package.json
├── tsconfig.json
└── .env
```

---

## Phase 1: Database & Configuration

### 1.1 Database Schema

Create `packages/server/src/db/schema.sql`:

```sql
-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT,      -- JSON array
  tool_results TEXT,    -- JSON array
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guidelines TEXT NOT NULL DEFAULT '',
  system_prompt TEXT,
  mcp_server_config TEXT,  -- JSON
  model_config TEXT,       -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Config (key-value store for settings)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 1.2 Database Initialization

Create `packages/server/src/db/index.ts`:

```typescript
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export async function initDatabase(): Promise<void> {
  // Ensure data directory exists
  const dbDir = dirname(config.databasePath)
  mkdirSync(dbDir, { recursive: true })

  // Initialize database
  db = new Database(config.databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
  db.exec(schema)

  console.log('Database initialized at', config.databasePath)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
  }
}
```

### 1.3 Config Service

Create `packages/server/src/services/config.ts`:

```typescript
import { getDb } from '../db/index.js'
import { z } from 'zod'

// Schema matching the desktop app's config
export const AppConfigSchema = z.object({
  // STT
  sttProviderId: z.enum(['openai', 'groq']).default('openai'),
  sttLanguage: z.string().optional(),

  // TTS
  ttsEnabled: z.boolean().default(false),
  ttsProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),

  // Agent
  mcpToolsProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),
  mcpMaxIterations: z.number().default(25),
  mcpRequireApprovalBeforeToolCall: z.boolean().default(false),
  mcpMessageQueueEnabled: z.boolean().default(true),

  // Post-processing
  postProcessingEnabled: z.boolean().default(false),
  postProcessingProviderId: z.enum(['openai', 'groq', 'gemini']).default('openai'),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const configService = {
  get(): AppConfig {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM config').all() as { key: string; value: string }[]

    const configObj: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        configObj[row.key] = JSON.parse(row.value)
      } catch {
        configObj[row.key] = row.value
      }
    }

    return AppConfigSchema.parse(configObj)
  },

  update(patch: Partial<AppConfig>): AppConfig {
    const db = getDb()
    const now = Date.now()

    const stmt = db.prepare(`
      INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)

    for (const [key, value] of Object.entries(patch)) {
      stmt.run(key, JSON.stringify(value), now)
    }

    return this.get()
  },

  // Get current profile ID
  getCurrentProfileId(): string | null {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('currentProfileId') as { value: string } | undefined
    return row?.value ?? null
  },

  setCurrentProfileId(profileId: string): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO app_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('currentProfileId', profileId)
  },
}
```

---

## Phase 2: Authentication

### 2.1 Auth Middleware

Create `packages/server/src/middleware/auth.ts`:

```typescript
import { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'

// Paths that don't require authentication
const PUBLIC_PATHS = ['/api/health']

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip auth for public paths
  if (PUBLIC_PATHS.some(path => request.url.startsWith(path))) {
    return
  }

  const authHeader = request.headers.authorization

  if (!authHeader) {
    return reply.status(401).send({ error: 'Missing Authorization header' })
  }

  // Support both "Bearer <token>" and just "<token>"
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (token !== config.apiKey) {
    return reply.status(401).send({ error: 'Invalid API key' })
  }
}
```

### 2.2 Health Check Route

Create `packages/server/src/routes/health.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { getDb } from '../db/index.js'

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get('/health', async () => {
    // Check database connection
    try {
      const db = getDb()
      db.prepare('SELECT 1').get()
      return { status: 'ok', database: 'connected' }
    } catch (error) {
      return { status: 'error', database: 'disconnected' }
    }
  })
}
```

### 2.3 Config Routes

Create `packages/server/src/routes/config.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { configService, AppConfigSchema } from '../services/config.js'
import { z } from 'zod'

export const configRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/config
  server.get('/config', async () => {
    return configService.get()
  })

  // PATCH /api/config
  server.patch('/config', async (request) => {
    const patch = AppConfigSchema.partial().parse(request.body)
    return configService.update(patch)
  })
}
```

---

## Phase 3: Conversations (First Vertical Slice)

This phase implements a complete feature end-to-end as a template for others.

### 3.1 Conversation Service

Create `packages/server/src/services/conversation.ts`:

```typescript
import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'

// Types
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  timestamp: z.number(),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.any(),
  })).optional(),
  toolResults: z.array(z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  })).optional(),
})

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type Message = z.infer<typeof MessageSchema>
export type Conversation = z.infer<typeof ConversationSchema>

export const conversationService = {
  // List all conversations (without messages for performance)
  list(): Array<Omit<Conversation, 'messages'>> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM conversations
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; title: string; created_at: number; updated_at: number }>

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      messages: [], // Not loaded for list
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  },

  // Get single conversation with messages
  get(id: string): Conversation | null {
    const db = getDb()

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as {
      id: string; title: string; created_at: number; updated_at: number
    } | undefined

    if (!conv) return null

    const messages = db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC
    `).all(id) as Array<{
      id: string; conversation_id: string; role: string; content: string;
      timestamp: number; tool_calls: string | null; tool_results: string | null
    }>

    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
        toolResults: m.tool_results ? JSON.parse(m.tool_results) : undefined,
      })),
    }
  },

  // Create new conversation
  create(firstMessage: string, role: 'user' | 'assistant' = 'user'): Conversation {
    const db = getDb()
    const now = Date.now()
    const convId = `conv_${nanoid()}`
    const msgId = `msg_${nanoid()}`

    // Generate title from first message
    const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '')

    db.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(convId, title, now, now)

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, convId, role, firstMessage, now)

    return this.get(convId)!
  },

  // Add message to conversation
  addMessage(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant' | 'tool',
    toolCalls?: Message['toolCalls'],
    toolResults?: Message['toolResults']
  ): Message {
    const db = getDb()
    const now = Date.now()
    const msgId = `msg_${nanoid()}`

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      conversationId,
      role,
      content,
      now,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null
    )

    // Update conversation's updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)

    return {
      id: msgId,
      role,
      content,
      timestamp: now,
      toolCalls,
      toolResults,
    }
  },

  // Delete conversation
  delete(id: string): boolean {
    const db = getDb()
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return result.changes > 0
  },

  // Delete all conversations
  deleteAll(): number {
    const db = getDb()
    const result = db.prepare('DELETE FROM conversations').run()
    return result.changes
  },

  // Update conversation title
  updateTitle(id: string, title: string): boolean {
    const db = getDb()
    const result = db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
    return result.changes > 0
  },
}
```

### 3.2 Conversation Routes

Create `packages/server/src/routes/conversations.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { conversationService } from '../services/conversation.js'
import { z } from 'zod'

const CreateConversationBody = z.object({
  message: z.string().min(1),
  role: z.enum(['user', 'assistant']).default('user'),
})

const AddMessageBody = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool']),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.any(),
  })).optional(),
  toolResults: z.array(z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  })).optional(),
})

export const conversationRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/conversations - List all
  server.get('/conversations', async () => {
    return conversationService.list()
  })

  // POST /api/conversations - Create new
  server.post('/conversations', async (request, reply) => {
    const body = CreateConversationBody.parse(request.body)
    const conversation = conversationService.create(body.message, body.role)
    return reply.status(201).send(conversation)
  })

  // GET /api/conversations/:id - Get one
  server.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const conversation = conversationService.get(request.params.id)
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return conversation
  })

  // DELETE /api/conversations/:id - Delete one
  server.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const deleted = conversationService.delete(request.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }
    return { success: true }
  })

  // DELETE /api/conversations - Delete all
  server.delete('/conversations', async () => {
    const count = conversationService.deleteAll()
    return { deleted: count }
  })

  // POST /api/conversations/:id/messages - Add message
  server.post<{ Params: { id: string } }>('/conversations/:id/messages', async (request, reply) => {
    const body = AddMessageBody.parse(request.body)

    // Check conversation exists
    const conversation = conversationService.get(request.params.id)
    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' })
    }

    const message = conversationService.addMessage(
      request.params.id,
      body.content,
      body.role,
      body.toolCalls,
      body.toolResults
    )
    return reply.status(201).send(message)
  })
}
```

### 3.3 Test the Conversations API

Create `packages/server/src/routes/conversations.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { conversationRoutes } from './conversations.js'
import { initDatabase, closeDatabase } from '../db/index.js'

describe('Conversations API', () => {
  const server = Fastify()

  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:'
    await initDatabase()
    await server.register(conversationRoutes, { prefix: '/api' })
  })

  afterAll(async () => {
    await server.close()
    closeDatabase()
  })

  it('should create a conversation', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { message: 'Hello, world!' },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.id).toBeDefined()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content).toBe('Hello, world!')
  })

  it('should list conversations', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/conversations',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(Array.isArray(body)).toBe(true)
  })

  it('should add a message to conversation', async () => {
    // Create conversation first
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { message: 'Initial message' },
    })
    const conv = JSON.parse(createRes.body)

    // Add message
    const response = await server.inject({
      method: 'POST',
      url: `/api/conversations/${conv.id}/messages`,
      payload: { content: 'Reply message', role: 'assistant' },
    })

    expect(response.statusCode).toBe(201)
    const message = JSON.parse(response.body)
    expect(message.content).toBe('Reply message')
    expect(message.role).toBe('assistant')
  })
})
```

Run tests:
```bash
cd packages/server
npm test
```

---

## Phase 4: Profiles Service

### 4.1 Profile Service

Create `packages/server/src/services/profile.ts`:

```typescript
import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { configService } from './config.js'

export const ProfileMcpConfigSchema = z.object({
  disabledServers: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
})

export const ProfileModelConfigSchema = z.object({
  providerId: z.enum(['openai', 'groq', 'gemini']).optional(),
  modelId: z.string().optional(),
  customPresetId: z.string().optional(),
})

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  guidelines: z.string(),
  systemPrompt: z.string().optional(),
  mcpServerConfig: ProfileMcpConfigSchema.optional(),
  modelConfig: ProfileModelConfigSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type Profile = z.infer<typeof ProfileSchema>
export type ProfileMcpConfig = z.infer<typeof ProfileMcpConfigSchema>
export type ProfileModelConfig = z.infer<typeof ProfileModelConfigSchema>

export const profileService = {
  list(): Profile[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all() as Array<{
      id: string; name: string; guidelines: string; system_prompt: string | null;
      mcp_server_config: string | null; model_config: string | null;
      created_at: number; updated_at: number
    }>

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      guidelines: row.guidelines,
      systemPrompt: row.system_prompt ?? undefined,
      mcpServerConfig: row.mcp_server_config ? JSON.parse(row.mcp_server_config) : undefined,
      modelConfig: row.model_config ? JSON.parse(row.model_config) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  },

  get(id: string): Profile | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as {
      id: string; name: string; guidelines: string; system_prompt: string | null;
      mcp_server_config: string | null; model_config: string | null;
      created_at: number; updated_at: number
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      guidelines: row.guidelines,
      systemPrompt: row.system_prompt ?? undefined,
      mcpServerConfig: row.mcp_server_config ? JSON.parse(row.mcp_server_config) : undefined,
      modelConfig: row.model_config ? JSON.parse(row.model_config) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  },

  getCurrent(): Profile | null {
    const currentId = configService.getCurrentProfileId()
    if (!currentId) return null
    return this.get(currentId)
  },

  create(name: string, guidelines: string, systemPrompt?: string): Profile {
    const db = getDb()
    const now = Date.now()
    const id = `profile_${nanoid()}`

    db.prepare(`
      INSERT INTO profiles (id, name, guidelines, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, guidelines, systemPrompt ?? null, now, now)

    return this.get(id)!
  },

  update(id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>): Profile | null {
    const db = getDb()
    const existing = this.get(id)
    if (!existing) return null

    const now = Date.now()

    db.prepare(`
      UPDATE profiles SET
        name = ?,
        guidelines = ?,
        system_prompt = ?,
        mcp_server_config = ?,
        model_config = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? existing.name,
      updates.guidelines ?? existing.guidelines,
      updates.systemPrompt ?? existing.systemPrompt ?? null,
      updates.mcpServerConfig ? JSON.stringify(updates.mcpServerConfig) :
        (existing.mcpServerConfig ? JSON.stringify(existing.mcpServerConfig) : null),
      updates.modelConfig ? JSON.stringify(updates.modelConfig) :
        (existing.modelConfig ? JSON.stringify(existing.modelConfig) : null),
      now,
      id
    )

    return this.get(id)
  },

  delete(id: string): boolean {
    const db = getDb()

    // Don't delete if it's the current profile
    const currentId = configService.getCurrentProfileId()
    if (currentId === id) {
      configService.setCurrentProfileId('')
    }

    const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return result.changes > 0
  },

  setCurrentProfile(id: string): Profile | null {
    const profile = this.get(id)
    if (!profile) return null
    configService.setCurrentProfileId(id)
    return profile
  },

  // Create a snapshot for session isolation
  createSnapshot(profileId: string): Profile | null {
    const profile = this.get(profileId)
    if (!profile) return null

    // Return a deep copy
    return JSON.parse(JSON.stringify(profile))
  },
}
```

### 4.2 Profile Routes

Create `packages/server/src/routes/profiles.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { profileService } from '../services/profile.js'
import { z } from 'zod'

const CreateProfileBody = z.object({
  name: z.string().min(1),
  guidelines: z.string().default(''),
  systemPrompt: z.string().optional(),
})

const UpdateProfileBody = z.object({
  name: z.string().min(1).optional(),
  guidelines: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcpServerConfig: z.object({
    disabledServers: z.array(z.string()).optional(),
    disabledTools: z.array(z.string()).optional(),
  }).optional(),
  modelConfig: z.object({
    providerId: z.enum(['openai', 'groq', 'gemini']).optional(),
    modelId: z.string().optional(),
  }).optional(),
})

export const profileRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/profiles
  server.get('/profiles', async () => {
    return profileService.list()
  })

  // GET /api/profiles/current
  server.get('/profiles/current', async (request, reply) => {
    const profile = profileService.getCurrent()
    if (!profile) {
      return reply.status(404).send({ error: 'No current profile set' })
    }
    return profile
  })

  // POST /api/profiles
  server.post('/profiles', async (request, reply) => {
    const body = CreateProfileBody.parse(request.body)
    const profile = profileService.create(body.name, body.guidelines, body.systemPrompt)
    return reply.status(201).send(profile)
  })

  // GET /api/profiles/:id
  server.get<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const profile = profileService.get(request.params.id)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // PATCH /api/profiles/:id
  server.patch<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const body = UpdateProfileBody.parse(request.body)
    const profile = profileService.update(request.params.id, body)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // DELETE /api/profiles/:id
  server.delete<{ Params: { id: string } }>('/profiles/:id', async (request, reply) => {
    const deleted = profileService.delete(request.params.id)
    if (!deleted) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return { success: true }
  })

  // POST /api/profiles/:id/activate
  server.post<{ Params: { id: string } }>('/profiles/:id/activate', async (request, reply) => {
    const profile = profileService.setCurrentProfile(request.params.id)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    return profile
  })

  // GET /api/profiles/:id/export
  server.get<{ Params: { id: string } }>('/profiles/:id/export', async (request, reply) => {
    const profile = profileService.get(request.params.id)
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' })
    }
    // Return profile without id for export
    const { id, createdAt, updatedAt, ...exportData } = profile
    return exportData
  })

  // POST /api/profiles/import
  server.post('/profiles/import', async (request, reply) => {
    const body = UpdateProfileBody.parse(request.body)
    if (!body.name) {
      return reply.status(400).send({ error: 'Name is required for import' })
    }
    const profile = profileService.create(body.name, body.guidelines ?? '', body.systemPrompt)
    if (body.mcpServerConfig || body.modelConfig) {
      profileService.update(profile.id, {
        mcpServerConfig: body.mcpServerConfig,
        modelConfig: body.modelConfig,
      })
    }
    return reply.status(201).send(profileService.get(profile.id))
  })
}
```

---

## Phase 5: MCP Service

This is the most complex service. It manages MCP server connections as child processes.

### 5.1 MCP Server Manager

Create `packages/server/src/services/mcp.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { z } from 'zod'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpServer {
  name: string
  config: McpServerConfig
  client: Client | null
  process: ChildProcess | null
  status: 'stopped' | 'starting' | 'running' | 'error'
  error?: string
  tools: McpTool[]
  enabled: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: unknown
  serverName: string
  enabled: boolean
}

// Singleton MCP service
class McpService extends EventEmitter {
  private servers: Map<string, McpServer> = new Map()
  private disabledTools: Set<string> = new Set()
  private logs: Map<string, string[]> = new Map()

  async startServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      await this.stopServer(name)
    }

    const server: McpServer = {
      name,
      config,
      client: null,
      process: null,
      status: 'starting',
      tools: [],
      enabled: true,
    }
    this.servers.set(name, server)
    this.logs.set(name, [])

    try {
      // Spawn process
      const proc = spawn(config.command, config.args ?? [], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      server.process = proc

      // Capture stderr for logs
      proc.stderr?.on('data', (data) => {
        const log = data.toString()
        this.addLog(name, log)
      })

      proc.on('exit', (code) => {
        server.status = code === 0 ? 'stopped' : 'error'
        this.emit('server:exit', { name, code })
      })

      // Create MCP client
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env },
      })

      const client = new Client({ name: `speakmcp-${name}`, version: '1.0.0' })
      await client.connect(transport)

      server.client = client
      server.status = 'running'

      // Fetch tools
      const toolsResult = await client.listTools()
      server.tools = toolsResult.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        serverName: name,
        enabled: !this.disabledTools.has(`${name}:${t.name}`),
      }))

      this.emit('server:started', { name, tools: server.tools })
    } catch (error) {
      server.status = 'error'
      server.error = error instanceof Error ? error.message : String(error)
      this.emit('server:error', { name, error: server.error })
      throw error
    }
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return

    if (server.client) {
      await server.client.close()
    }
    if (server.process) {
      server.process.kill()
    }

    server.status = 'stopped'
    server.client = null
    server.process = null
    this.emit('server:stopped', { name })
  }

  async restartServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`Server ${name} not found`)
    await this.startServer(name, server.config)
  }

  getStatus(): Array<{ name: string; status: string; toolCount: number; error?: string }> {
    return Array.from(this.servers.values()).map(s => ({
      name: s.name,
      status: s.status,
      toolCount: s.tools.length,
      error: s.error,
    }))
  }

  getAllTools(): McpTool[] {
    const tools: McpTool[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'running') {
        tools.push(...server.tools)
      }
    }
    return tools
  }

  getEnabledTools(): McpTool[] {
    return this.getAllTools().filter(t => t.enabled)
  }

  setToolEnabled(serverName: string, toolName: string, enabled: boolean): void {
    const key = `${serverName}:${toolName}`
    if (enabled) {
      this.disabledTools.delete(key)
    } else {
      this.disabledTools.add(key)
    }

    // Update in-memory tool
    const server = this.servers.get(serverName)
    if (server) {
      const tool = server.tools.find(t => t.name === toolName)
      if (tool) tool.enabled = enabled
    }
  }

  async executeTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const server = this.servers.get(serverName)
    if (!server || !server.client) {
      throw new Error(`Server ${serverName} not connected`)
    }

    const result = await server.client.callTool({ name: toolName, arguments: args as Record<string, unknown> })
    return result
  }

  private addLog(name: string, log: string): void {
    const logs = this.logs.get(name) ?? []
    logs.push(`[${new Date().toISOString()}] ${log}`)
    // Keep last 1000 lines
    if (logs.length > 1000) logs.shift()
    this.logs.set(name, logs)
  }

  getLogs(name: string): string[] {
    return this.logs.get(name) ?? []
  }

  clearLogs(name: string): void {
    this.logs.set(name, [])
  }
}

export const mcpService = new McpService()
```

### 5.2 MCP Routes

Create `packages/server/src/routes/mcp.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { mcpService } from '../services/mcp.js'
import { z } from 'zod'

const ServerConfigBody = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
})

export const mcpRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/mcp/servers
  server.get('/mcp/servers', async () => {
    return mcpService.getStatus()
  })

  // POST /api/mcp/servers/:name - Start server
  server.post<{ Params: { name: string } }>('/mcp/servers/:name', async (request, reply) => {
    const config = ServerConfigBody.parse(request.body)
    try {
      await mcpService.startServer(request.params.name, config)
      return { success: true }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to start server'
      })
    }
  })

  // POST /api/mcp/servers/:name/restart
  server.post<{ Params: { name: string } }>('/mcp/servers/:name/restart', async (request, reply) => {
    try {
      await mcpService.restartServer(request.params.name)
      return { success: true }
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to restart server'
      })
    }
  })

  // POST /api/mcp/servers/:name/stop
  server.post<{ Params: { name: string } }>('/mcp/servers/:name/stop', async (request, reply) => {
    await mcpService.stopServer(request.params.name)
    return { success: true }
  })

  // GET /api/mcp/servers/:name/logs
  server.get<{ Params: { name: string } }>('/mcp/servers/:name/logs', async (request) => {
    return { logs: mcpService.getLogs(request.params.name) }
  })

  // DELETE /api/mcp/servers/:name/logs
  server.delete<{ Params: { name: string } }>('/mcp/servers/:name/logs', async (request) => {
    mcpService.clearLogs(request.params.name)
    return { success: true }
  })

  // GET /api/mcp/tools
  server.get('/mcp/tools', async () => {
    return mcpService.getAllTools()
  })

  // PATCH /api/mcp/tools/:serverName/:toolName
  server.patch<{ Params: { serverName: string; toolName: string } }>(
    '/mcp/tools/:serverName/:toolName',
    async (request) => {
      const body = z.object({ enabled: z.boolean() }).parse(request.body)
      mcpService.setToolEnabled(request.params.serverName, request.params.toolName, body.enabled)
      return { success: true }
    }
  )

  // POST /api/mcp/tools/:serverName/:toolName/execute
  server.post<{ Params: { serverName: string; toolName: string } }>(
    '/mcp/tools/:serverName/:toolName/execute',
    async (request, reply) => {
      try {
        const result = await mcpService.executeTool(
          request.params.serverName,
          request.params.toolName,
          request.body
        )
        return result
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Tool execution failed'
        })
      }
    }
  )
}
```

---

## Phase 6: Agent Processing

The agent is the core LLM processing loop that handles tool calling.

### 6.1 Agent Service

Create `packages/server/src/services/agent.ts`:

```typescript
import { EventEmitter } from 'events'
import { nanoid } from 'nanoid'
import OpenAI from 'openai'
import { mcpService } from './mcp.js'
import { conversationService, type Conversation, type Message } from './conversation.js'
import { profileService, type Profile } from './profile.js'
import { config } from '../config.js'

// Types
export interface AgentSession {
  id: string
  conversationId: string
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  iteration: number
  maxIterations: number
  profileSnapshot: Profile | null
  startedAt: number
  error?: string
}

export interface AgentProgress {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'done'
  sessionId: string
  iteration?: number
  message?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  content?: string
  error?: string
}

export interface AgentOptions {
  conversationId?: string
  profileId?: string
  maxIterations?: number
  requireToolApproval?: boolean
}

class AgentService extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map()
  private abortControllers: Map<string, AbortController> = new Map()
  private pendingApprovals: Map<string, { resolve: (approved: boolean) => void }> = new Map()

  async *process(
    input: string,
    options: AgentOptions = {}
  ): AsyncGenerator<AgentProgress> {
    const sessionId = `session_${nanoid()}`
    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    // Create or get conversation
    let conversationId = options.conversationId
    if (!conversationId) {
      const conv = conversationService.create(input)
      conversationId = conv.id
    } else {
      // Add user message to existing conversation
      conversationService.addMessage(conversationId, input, 'user')
    }

    // Get profile snapshot for isolation
    const profileSnapshot = options.profileId
      ? profileService.createSnapshot(options.profileId)
      : profileService.getCurrent()

    const session: AgentSession = {
      id: sessionId,
      conversationId,
      status: 'running',
      iteration: 0,
      maxIterations: options.maxIterations ?? 25,
      profileSnapshot,
      startedAt: Date.now(),
    }
    this.sessions.set(sessionId, session)

    try {
      // Build messages for LLM
      const conversation = conversationService.get(conversationId)!
      const messages = this.buildMessages(conversation, profileSnapshot)
      const tools = this.buildTools()

      // Create OpenAI client (or other provider based on config)
      const openai = new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseUrl,
      })

      // Agent loop
      while (session.iteration < session.maxIterations && session.status === 'running') {
        if (abortController.signal.aborted) {
          session.status = 'stopped'
          yield { type: 'done', sessionId, message: 'Stopped by user' }
          return
        }

        session.iteration++
        yield { type: 'thinking', sessionId, iteration: session.iteration }

        // Call LLM
        const response = await openai.chat.completions.create({
          model: profileSnapshot?.modelConfig?.modelId ?? 'gpt-4o-mini',
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          tools: tools.length > 0 ? tools : undefined,
        })

        const choice = response.choices[0]
        const assistantMessage = choice.message

        // Check for tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          // Add assistant message with tool calls
          messages.push(assistantMessage as any)

          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            yield {
              type: 'tool_call',
              sessionId,
              toolName,
              toolArgs,
              iteration: session.iteration
            }

            // Handle tool approval if required
            if (options.requireToolApproval) {
              const approved = await this.waitForApproval(sessionId, toolName)
              if (!approved) {
                yield { type: 'tool_result', sessionId, toolName, toolResult: 'Tool call denied by user' }
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: 'Tool call denied by user',
                })
                continue
              }
            }

            // Execute tool
            try {
              // Find which server has this tool
              const allTools = mcpService.getAllTools()
              const tool = allTools.find(t => t.name === toolName)

              if (!tool) {
                throw new Error(`Tool ${toolName} not found`)
              }

              const result = await mcpService.executeTool(tool.serverName, toolName, toolArgs)

              yield { type: 'tool_result', sessionId, toolName, toolResult: result }

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              })
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              yield { type: 'tool_result', sessionId, toolName, toolResult: { error: errorMsg } }
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errorMsg }),
              })
            }
          }
        } else {
          // No tool calls - final response
          const content = assistantMessage.content ?? ''

          // Save to conversation
          conversationService.addMessage(conversationId, content, 'assistant')

          yield { type: 'response', sessionId, content }
          yield { type: 'done', sessionId }

          session.status = 'completed'
          return
        }
      }

      // Max iterations reached
      yield { type: 'error', sessionId, error: 'Max iterations reached' }
      session.status = 'error'
      session.error = 'Max iterations reached'

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      session.status = 'error'
      session.error = errorMsg
      yield { type: 'error', sessionId, error: errorMsg }
    } finally {
      this.abortControllers.delete(sessionId)
    }
  }

  stopSession(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      return true
    }
    return false
  }

  stopAllSessions(): number {
    let count = 0
    for (const [id, controller] of this.abortControllers) {
      controller.abort()
      count++
    }
    return count
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  respondToApproval(sessionId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(sessionId)
    if (pending) {
      pending.resolve(approved)
      this.pendingApprovals.delete(sessionId)
    }
  }

  private async waitForApproval(sessionId: string, toolName: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(sessionId, { resolve })
      this.emit('approval:required', { sessionId, toolName })

      // Auto-approve after 30 seconds
      setTimeout(() => {
        if (this.pendingApprovals.has(sessionId)) {
          this.pendingApprovals.delete(sessionId)
          resolve(true)
        }
      }, 30000)
    })
  }

  private buildMessages(conversation: Conversation, profile: Profile | null): any[] {
    const messages: any[] = []

    // System message from profile
    if (profile?.systemPrompt) {
      messages.push({ role: 'system', content: profile.systemPrompt })
    }
    if (profile?.guidelines) {
      messages.push({ role: 'system', content: `Guidelines:\n${profile.guidelines}` })
    }

    // Conversation history
    for (const msg of conversation.messages) {
      messages.push({ role: msg.role, content: msg.content })
    }

    return messages
  }

  private buildTools(): OpenAI.ChatCompletionTool[] {
    const mcpTools = mcpService.getEnabledTools()
    return mcpTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema as any,
      },
    }))
  }
}

export const agentService = new AgentService()
```

### 6.2 Agent Routes with SSE Streaming

Create `packages/server/src/routes/agent.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { agentService } from '../services/agent.js'
import { z } from 'zod'

const ProcessBody = z.object({
  input: z.string().min(1),
  conversationId: z.string().optional(),
  profileId: z.string().optional(),
  maxIterations: z.number().optional(),
  requireToolApproval: z.boolean().optional(),
})

export const agentRoutes: FastifyPluginAsync = async (server) => {
  // POST /api/agent/process - Process with SSE streaming
  server.post('/agent/process', async (request, reply) => {
    const body = ProcessBody.parse(request.body)

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const sendEvent = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      for await (const progress of agentService.process(body.input, {
        conversationId: body.conversationId,
        profileId: body.profileId,
        maxIterations: body.maxIterations,
        requireToolApproval: body.requireToolApproval,
      })) {
        sendEvent(progress)

        if (progress.type === 'done' || progress.type === 'error') {
          break
        }
      }
    } catch (error) {
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      reply.raw.end()
    }
  })

  // POST /api/agent/stop - Stop all sessions
  server.post('/agent/stop', async () => {
    const count = agentService.stopAllSessions()
    return { stopped: count }
  })

  // POST /api/agent/stop/:sessionId - Stop specific session
  server.post<{ Params: { sessionId: string } }>('/agent/stop/:sessionId', async (request, reply) => {
    const stopped = agentService.stopSession(request.params.sessionId)
    if (!stopped) {
      return reply.status(404).send({ error: 'Session not found or already stopped' })
    }
    return { success: true }
  })

  // GET /api/agent/sessions - List all sessions
  server.get('/agent/sessions', async () => {
    return agentService.getAllSessions()
  })

  // GET /api/agent/sessions/:sessionId - Get session
  server.get<{ Params: { sessionId: string } }>('/agent/sessions/:sessionId', async (request, reply) => {
    const session = agentService.getSession(request.params.sessionId)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    return session
  })

  // POST /api/agent/sessions/:sessionId/approval - Respond to tool approval
  server.post<{ Params: { sessionId: string } }>('/agent/sessions/:sessionId/approval', async (request) => {
    const body = z.object({ approved: z.boolean() }).parse(request.body)
    agentService.respondToApproval(request.params.sessionId, body.approved)
    return { success: true }
  })
}
```

---

## Phase 7: Real-time Communication

For clients that need push updates (tool approvals, progress from other sessions).

### 7.1 WebSocket Setup

Create `packages/server/src/websocket.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { agentService } from './services/agent.js'
import { mcpService } from './services/mcp.js'
import { WebSocket } from 'ws'

const clients: Set<WebSocket> = new Set()

export async function setupWebSocket(server: FastifyInstance) {
  await server.register(fastifyWebsocket)

  server.get('/ws', { websocket: true }, (socket, request) => {
    clients.add(socket)

    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString())
        handleClientMessage(socket, message)
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }))
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
    })

    // Send initial state
    socket.send(JSON.stringify({
      type: 'connected',
      sessions: agentService.getAllSessions(),
      mcpStatus: mcpService.getStatus(),
    }))
  })

  // Forward agent events to clients
  agentService.on('approval:required', (data) => {
    broadcast({ type: 'approval:required', ...data })
  })

  mcpService.on('server:started', (data) => {
    broadcast({ type: 'mcp:server:started', ...data })
  })

  mcpService.on('server:stopped', (data) => {
    broadcast({ type: 'mcp:server:stopped', ...data })
  })

  mcpService.on('server:error', (data) => {
    broadcast({ type: 'mcp:server:error', ...data })
  })
}

function handleClientMessage(socket: WebSocket, message: any) {
  switch (message.type) {
    case 'agent:stop':
      agentService.stopSession(message.sessionId)
      break
    case 'tool:approve':
      agentService.respondToApproval(message.sessionId, message.approved)
      break
    case 'ping':
      socket.send(JSON.stringify({ type: 'pong' }))
      break
  }
}

function broadcast(message: unknown) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}
```

### 7.2 Update Main Server

Update `packages/server/src/index.ts` to include WebSocket:

```typescript
import { setupWebSocket } from './websocket.js'

// After registering routes...
await setupWebSocket(server)
```

---

## Phase 8: Speech Services

### 8.1 Speech Service

Create `packages/server/src/services/speech.ts`:

```typescript
import OpenAI from 'openai'
import { config } from '../config.js'

export const speechService = {
  // Speech-to-Text
  async transcribe(audioBuffer: Buffer, format: 'webm' | 'wav' | 'mp3' = 'webm'): Promise<string> {
    const openai = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    })

    // Create a File-like object from buffer
    const file = new File([audioBuffer], `audio.${format}`, { type: `audio/${format}` })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    })

    return transcription.text
  },

  // Text-to-Speech
  async synthesize(text: string, voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'): Promise<Buffer> {
    const openai = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    })

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
    })

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  },
}
```

### 8.2 Speech Routes

Create `packages/server/src/routes/speech.ts`:

```typescript
import { FastifyPluginAsync } from 'fastify'
import { speechService } from '../services/speech.js'

export const speechRoutes: FastifyPluginAsync = async (server) => {
  // POST /api/speech/transcribe - Audio to text
  server.post('/speech/transcribe', async (request, reply) => {
    // Expect multipart form data with 'audio' field
    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' })
    }

    const buffer = await data.toBuffer()
    const text = await speechService.transcribe(buffer)

    return { text }
  })

  // POST /api/speech/synthesize - Text to audio
  server.post('/speech/synthesize', async (request, reply) => {
    const body = request.body as { text: string; voice?: string }

    if (!body.text) {
      return reply.status(400).send({ error: 'No text provided' })
    }

    const audioBuffer = await speechService.synthesize(
      body.text,
      body.voice as any ?? 'nova'
    )

    reply.header('Content-Type', 'audio/mpeg')
    return reply.send(audioBuffer)
  })
}
```

> **Note:** Add `@fastify/multipart` for file uploads:
> ```bash
> npm install @fastify/multipart
> ```
> And register it in `index.ts`:
> ```typescript
> import multipart from '@fastify/multipart'
> await server.register(multipart)
> ```

---

## Phase 9: Desktop Client Migration

### 9.1 Create API Client Package

Create `packages/client/src/index.ts`:

```typescript
export interface SpeakMCPClientConfig {
  baseUrl: string
  apiKey: string
  timeout?: number
}

export interface AgentProgress {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'done'
  sessionId: string
  iteration?: number
  message?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  content?: string
  error?: string
}

export class SpeakMCPClient {
  private baseUrl: string
  private apiKey: string
  private timeout: number

  constructor(config: SpeakMCPClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30000
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response
  }

  // Config
  async getConfig() {
    const res = await this.fetch('/api/config')
    return res.json()
  }

  async updateConfig(patch: Record<string, unknown>) {
    const res = await this.fetch('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return res.json()
  }

  // Profiles
  async getProfiles() {
    const res = await this.fetch('/api/profiles')
    return res.json()
  }

  async getCurrentProfile() {
    const res = await this.fetch('/api/profiles/current')
    return res.json()
  }

  async activateProfile(profileId: string) {
    const res = await this.fetch(`/api/profiles/${profileId}/activate`, { method: 'POST' })
    return res.json()
  }

  // Conversations
  async getConversations() {
    const res = await this.fetch('/api/conversations')
    return res.json()
  }

  async getConversation(id: string) {
    const res = await this.fetch(`/api/conversations/${id}`)
    return res.json()
  }

  async createConversation(message: string) {
    const res = await this.fetch('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
    return res.json()
  }

  // Agent - with SSE streaming
  async *processAgent(input: string, options?: {
    conversationId?: string
    profileId?: string
    maxIterations?: number
  }): AsyncGenerator<AgentProgress> {
    const response = await fetch(`${this.baseUrl}/api/agent/process`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input, ...options }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          yield data
        }
      }
    }
  }

  async stopAgent(sessionId?: string) {
    const path = sessionId ? `/api/agent/stop/${sessionId}` : '/api/agent/stop'
    const res = await this.fetch(path, { method: 'POST' })
    return res.json()
  }

  // MCP
  async getMcpServers() {
    const res = await this.fetch('/api/mcp/servers')
    return res.json()
  }

  async getMcpTools() {
    const res = await this.fetch('/api/mcp/tools')
    return res.json()
  }

  // Speech
  async transcribe(audioBlob: Blob): Promise<string> {
    const formData = new FormData()
    formData.append('audio', audioBlob)

    const response = await fetch(`${this.baseUrl}/api/speech/transcribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    })

    const data = await response.json()
    return data.text
  }

  async synthesize(text: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/speech/synthesize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })

    return response.blob()
  }
}
```

### 9.2 Update Desktop App to Use Client

In the Electron app, replace TIPC calls with API client calls.

**Before (IPC):**
```typescript
// apps/desktop/src/renderer/components/ChatInput.tsx
import { tipc } from '../tipc'

async function sendMessage(text: string) {
  await tipc.createMcpTextInput.mutate({ userInput: text })
}
```

**After (HTTP API):**
```typescript
// apps/desktop/src/renderer/components/ChatInput.tsx
import { useApiClient } from '../hooks/useApiClient'

function ChatInput() {
  const client = useApiClient()

  async function sendMessage(text: string) {
    for await (const progress of client.processAgent(text)) {
      // Handle progress updates
      if (progress.type === 'response') {
        addMessage(progress.content)
      }
    }
  }
}
```

### 9.3 Create API Client Hook

```typescript
// apps/desktop/src/renderer/hooks/useApiClient.ts
import { SpeakMCPClient } from '@speakmcp/client'
import { useMemo } from 'react'

export function useApiClient() {
  return useMemo(() => {
    // In Electron, connect to local server or remote
    const config = window.electron.getConfig()
    return new SpeakMCPClient({
      baseUrl: config.serverUrl ?? 'http://localhost:3456',
      apiKey: config.apiKey,
    })
  }, [])
}
```

### 9.4 Keep Platform-Specific Features in Electron

These should remain as IPC calls:

```typescript
// apps/desktop/src/renderer/tipc-platform.ts
// Platform-specific IPC that can't be moved to server

export const platformTipc = {
  // Window management
  showPanelWindow: () => tipc.showPanelWindow.mutate(),
  hidePanelWindow: () => tipc.hidePanelWindow.mutate(),
  resizePanel: (mode: 'agent' | 'normal') => tipc.resizePanelForAgentMode.mutate({ mode }),

  // System
  showContextMenu: () => tipc.showContextMenu.mutate(),
  checkAccessibilityPermission: () => tipc.checkAccessibilityPermission.query(),

  // Audio recording (uses native APIs)
  startRecording: () => tipc.startRecording.mutate(),
  stopRecording: () => tipc.stopRecording.mutate(),

  // Keyboard shortcuts (native binary)
  registerShortcut: (shortcut: string) => tipc.registerShortcut.mutate({ shortcut }),
}
```

---

## Quick Start Commands

```bash
# 1. Create server package
cd packages
mkdir -p server/src/{routes,services,db,middleware,utils}
cd server

# 2. Initialize and install
npm init -y
npm install fastify @fastify/cors @fastify/websocket @fastify/multipart \
  better-sqlite3 zod @modelcontextprotocol/sdk openai nanoid
npm install -D typescript tsx vitest @types/better-sqlite3 @types/node

# 3. Create files (copy from this guide)

# 4. Run development server
npm run dev

# 5. Test endpoints
curl http://localhost:3456/api/health
curl -H "Authorization: Bearer your-api-key" http://localhost:3456/api/config
```

---

## Checklist

### Phase 0: Project Setup
- [ ] Create `packages/server` directory structure
- [ ] Set up `package.json` with dependencies
- [ ] Configure TypeScript
- [ ] Create environment variables
- [ ] Bootstrap Fastify server

### Phase 1: Database
- [ ] Create SQLite schema
- [ ] Implement database initialization
- [ ] Test database connection

### Phase 2: Authentication
- [ ] Implement auth middleware
- [ ] Create health check endpoint
- [ ] Test authentication

### Phase 3: Conversations
- [ ] Implement conversation service
- [ ] Create conversation routes
- [ ] Write and run tests

### Phase 4: Profiles
- [ ] Implement profile service
- [ ] Create profile routes
- [ ] Test profile CRUD

### Phase 5: MCP
- [ ] Implement MCP server manager
- [ ] Create MCP routes
- [ ] Test server start/stop

### Phase 6: Agent
- [ ] Implement agent service with tool loop
- [ ] Create SSE streaming endpoint
- [ ] Test agent processing

### Phase 7: Real-time
- [ ] Set up WebSocket
- [ ] Forward events to clients
- [ ] Handle client messages

### Phase 8: Speech
- [ ] Implement STT/TTS service
- [ ] Create speech routes
- [ ] Test with audio files

### Phase 9: Client Migration
- [ ] Create client SDK package
- [ ] Update Electron renderer
- [ ] Keep platform-specific IPC
- [ ] Test end-to-end

---

## Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0: Setup | 1 day | None |
| Phase 1: Database | 1 day | Phase 0 |
| Phase 2: Auth | 0.5 days | Phase 0 |
| Phase 3: Conversations | 1 day | Phase 1, 2 |
| Phase 4: Profiles | 1 day | Phase 1, 2 |
| Phase 5: MCP | 2-3 days | Phase 2 |
| Phase 6: Agent | 2-3 days | Phase 3, 4, 5 |
| Phase 7: Real-time | 1 day | Phase 6 |
| Phase 8: Speech | 1 day | Phase 2 |
| Phase 9: Migration | 2-3 days | All above |

**Total: ~2-3 weeks** for a developer familiar with the codebase.

