/**
 * E2E regression: standalone server must sync active preset credentials
 * to legacy OpenAI fields so CLI uses the preset API key (not stale legacy key).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer, type Server as HttpServer } from 'http'
import { createServer as createNetServer } from 'net'
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { PtyDriver } from '../helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MONOREPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const SERVER_ENTRY = resolve(MONOREPO_ROOT, 'packages/server/dist/index.js')

const E2E_TIMEOUT_MS = 120_000

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  errorMessage: string,
  intervalMs: number = 100,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(errorMessage)
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate free port'))
        return
      }
      const port = address.port
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

async function waitForServerReady(url: string, apiKey: string, timeoutMs: number): Promise<void> {
  await waitForCondition(
    async () => {
      try {
        const response = await fetch(`${url}/v1/settings`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        return response.ok
      } catch {
        return false
      }
    },
    timeoutMs,
    `Server at ${url} did not become ready in ${timeoutMs}ms`,
    250,
  )
}

async function stopProcess(process: ChildProcess | null): Promise<void> {
  if (!process) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finalize = () => {
      if (settled) return
      settled = true
      resolve()
    }

    process.once('exit', () => finalize())
    process.kill('SIGTERM')

    setTimeout(() => {
      if (!settled) {
        process.kill('SIGKILL')
      }
      finalize()
    }, 2000)
  })
}

async function closeHttpServer(server: HttpServer | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

describe('Model Preset Auth Sync', () => {
  let cliDriver: PtyDriver | null = null
  let standaloneServerProcess: ChildProcess | null = null
  let mockProviderServer: HttpServer | null = null
  let tempDataDir: string | null = null

  afterEach(async () => {
    if (cliDriver) {
      cliDriver.kill()
      cliDriver = null
    }
    await stopProcess(standaloneServerProcess)
    standaloneServerProcess = null
    await closeHttpServer(mockProviderServer)
    mockProviderServer = null
    if (tempDataDir) {
      rmSync(tempDataDir, { recursive: true, force: true })
      tempDataDir = null
    }
  })

  it(
    'should use active preset API key instead of stale legacy openaiApiKey',
    async () => {
      const providerAuthHeaders: string[] = []

      mockProviderServer = createHttpServer((req, res) => {
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          providerAuthHeaders.push(String(req.headers.authorization || ''))
          req.on('data', () => {
            // Drain request body.
          })
          req.on('end', () => {
            const body = {
              id: 'chatcmpl-mock',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-model',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'preset-sync-ok',
                  },
                  finish_reason: 'stop',
                },
              ],
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(body))
          })
          return
        }

        if (req.method === 'GET' && req.url === '/v1/models') {
          const body = {
            object: 'list',
            data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }],
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
          return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
      })

      await new Promise<void>((resolve) => {
        mockProviderServer!.listen(0, '127.0.0.1', () => resolve())
      })
      const providerAddress = mockProviderServer.address()
      if (!providerAddress || typeof providerAddress === 'string') {
        throw new Error('Failed to read mock provider address')
      }
      const mockProviderBaseUrl = `http://127.0.0.1:${providerAddress.port}/v1`

      const presetApiKey = 'preset-openrouter-key'
      const staleLegacyApiKey = 'legacy-openai-key'
      const serverApiKey = 'standalone-e2e-api-key'

      tempDataDir = mkdtempSync(join(tmpdir(), 'speakmcp-cli-preset-sync-'))
      const seededConfig = {
        mcpToolsProviderId: 'openai',
        currentModelPresetId: 'custom-preset-sync',
        modelPresets: [
          {
            id: 'custom-preset-sync',
            name: 'Mock Provider',
            baseUrl: mockProviderBaseUrl,
            apiKey: presetApiKey,
            isBuiltIn: false,
            mcpToolsModel: 'mock-model',
            transcriptProcessingModel: 'mock-model',
          },
        ],
        // Deliberately stale legacy fields to reproduce the bug:
        openaiBaseUrl: mockProviderBaseUrl,
        openaiApiKey: staleLegacyApiKey,
        mcpToolsOpenaiModel: 'mock-model',
        transcriptPostProcessingOpenaiModel: 'mock-model',
      }
      writeFileSync(
        join(tempDataDir, 'config.json'),
        JSON.stringify(seededConfig, null, 2),
      )

      const serverPort = await getFreePort()
      const serverUrl = `http://127.0.0.1:${serverPort}`

      standaloneServerProcess = spawn(
        'node',
        [SERVER_ENTRY, '--port', String(serverPort), '--api-key', serverApiKey],
        {
          cwd: MONOREPO_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            NODE_ENV: 'test',
            NO_COLOR: '1',
            SPEAKMCP_DATA_DIR: tempDataDir,
          },
        },
      )

      await waitForServerReady(serverUrl, serverApiKey, 30_000)

      cliDriver = new PtyDriver({
        serverUrl,
        apiKey: serverApiKey,
      })
      await cliDriver.spawn()
      await cliDriver.waitForStable(1000, 10_000)

      cliDriver.typeAndEnter('Reply with exactly: preset-sync-ok')

      await waitForCondition(
        () => providerAuthHeaders.length > 0,
        45_000,
        'Mock provider did not receive a chat completion request',
      )

      expect(providerAuthHeaders[0]).toBe(`Bearer ${presetApiKey}`)
      await cliDriver.waitForText('preset-sync-ok', 45_000)
    },
    E2E_TIMEOUT_MS,
  )
})
