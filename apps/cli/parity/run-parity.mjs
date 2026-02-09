#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cliRoot = path.resolve(__dirname, '..')
const reportDir = path.resolve(__dirname, 'reports')
const uxLogDir = path.join(os.homedir(), '.speakmcp', 'logs')
const uxLogPath = path.join(uxLogDir, 'cli-ux-regression.jsonl')

const argv = new Set(process.argv.slice(2))
const mode = argv.has('--smoke') || process.env.PARITY_MODE === 'smoke' ? 'smoke' : 'full'
const runsPerScenario = Number(process.env.PARITY_RUNS_PER_SCENARIO || '3')

const cliTarget = process.env.SPEAKMCP_PARITY_CLI_URL || 'http://127.0.0.1:3210'
const desktopTarget = process.env.SPEAKMCP_PARITY_DESKTOP_URL || cliTarget
const parityApiKey = (
  process.env.SPEAKMCP_PARITY_API_KEY ||
  process.env.SPEAKMCP_API_KEY ||
  process.env.PARITY_API_KEY ||
  ''
).trim()

if (!Number.isFinite(runsPerScenario) || runsPerScenario <= 0) {
  console.error('[parity] Invalid PARITY_RUNS_PER_SCENARIO value')
  process.exit(1)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function nowIso() {
  return new Date().toISOString()
}

function randomSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sortedStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => sortedStringify(item)).join(',')}]`
  }
  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  const objectValue = value
  const keys = Object.keys(objectValue).sort()
  const parts = keys.map((key) => `${JSON.stringify(key)}:${sortedStringify(objectValue[key])}`)
  return `{${parts.join(',')}}`
}

function stdDev(values) {
  if (!values.length) return 0
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length
  return Math.sqrt(variance)
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function requestJson(target, method, endpoint, body, timeoutMs = 20000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers = {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (parityApiKey) {
      headers.Authorization = `Bearer ${parityApiKey}`
    }

    const response = await fetch(`${target}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await response.text()
    const json = safeJsonParse(text)

    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function makeClient(target) {
  return {
    get: (endpoint) => requestJson(target, 'GET', endpoint),
    post: (endpoint, body) => requestJson(target, 'POST', endpoint, body),
    patch: (endpoint, body) => requestJson(target, 'PATCH', endpoint, body),
    delete: (endpoint, body) => requestJson(target, 'DELETE', endpoint, body),
  }
}

const scenarios = [
  {
    id: 'settings-roundtrip',
    name: 'Settings roundtrip parity',
    estimatedKeystrokes: 22,
    run: async (client) => {
      const before = await client.get('/v1/settings')
      if (!before.ok || !before.json) {
        throw new Error(`Unable to fetch settings (${before.status}): ${before.text}`)
      }

      const currentTtsEnabled = typeof before.json.ttsEnabled === 'boolean'
        ? before.json.ttsEnabled
        : false
      const patch = await client.patch('/v1/settings', {
        ttsEnabled: !currentTtsEnabled,
      })
      if (!patch.ok) {
        throw new Error(`Unable to patch settings (${patch.status}): ${patch.text}`)
      }

      const restore = await client.patch('/v1/settings', {
        ttsEnabled: currentTtsEnabled,
      })
      if (!restore.ok) {
        throw new Error(`Unable to restore settings (${restore.status}): ${restore.text}`)
      }

      const after = await client.get('/v1/settings')
      if (!after.ok || !after.json) {
        throw new Error(`Unable to re-fetch settings (${after.status}): ${after.text}`)
      }

      return {
        signature: {
          ttsEnabled: after.json.ttsEnabled,
          hasMemoriesToggle: typeof after.json.memoriesEnabled === 'boolean',
          hasQueueToggle: typeof after.json.mcpMessageQueueEnabled === 'boolean',
        },
        recoverableErrors: 0,
      }
    },
  },
  {
    id: 'memories-crud',
    name: 'Memories CRUD parity',
    estimatedKeystrokes: 28,
    run: async (client) => {
      const suffix = randomSuffix()
      const create = await client.post('/v1/memories', {
        title: `parity-memory-${suffix}`,
        content: 'parity memory content',
        tags: ['parity'],
        importance: 'medium',
      })
      if (!create.ok || !create.json?.memory?.id) {
        throw new Error(`Memory create failed (${create.status}): ${create.text}`)
      }

      const memoryId = create.json.memory.id
      const update = await client.patch(`/v1/memories/${encodeURIComponent(memoryId)}`, {
        content: 'parity memory content updated',
      })
      if (!update.ok) {
        throw new Error(`Memory update failed (${update.status}): ${update.text}`)
      }

      const del = await client.delete(`/v1/memories/${encodeURIComponent(memoryId)}`)
      if (!del.ok) {
        throw new Error(`Memory delete failed (${del.status}): ${del.text}`)
      }

      return {
        signature: {
          created: true,
          updated: true,
          deleted: true,
        },
        recoverableErrors: 0,
      }
    },
  },
  {
    id: 'skills-lifecycle',
    name: 'Skills lifecycle/import parity',
    estimatedKeystrokes: 34,
    run: async (client) => {
      const suffix = randomSuffix()
      const create = await client.post('/v1/skills', {
        name: `Parity Skill ${suffix}`,
        description: 'Parity test skill',
        instructions: '# Parity Skill\n\nInstruction payload',
      })
      if (!create.ok || !create.json?.skill?.id) {
        throw new Error(`Skill create failed (${create.status}): ${create.text}`)
      }

      const skillId = create.json.skill.id
      const markdownImport = await client.post('/v1/skills/import/markdown', {
        content: '# Skill Name\n\n## Description\nImported skill\n\n## Instructions\nDo the thing.',
      })
      if (!markdownImport.ok) {
        throw new Error(`Skill markdown import failed (${markdownImport.status}): ${markdownImport.text}`)
      }

      const exportResult = await client.get(`/v1/skills/${encodeURIComponent(skillId)}/export`)
      if (!exportResult.ok) {
        throw new Error(`Skill export failed (${exportResult.status}): ${exportResult.text}`)
      }

      const deleteCreated = await client.delete(`/v1/skills/${encodeURIComponent(skillId)}`)
      if (!deleteCreated.ok) {
        throw new Error(`Skill delete failed (${deleteCreated.status}): ${deleteCreated.text}`)
      }

      if (markdownImport.json?.skill?.id) {
        await client.delete(`/v1/skills/${encodeURIComponent(markdownImport.json.skill.id)}`)
      }

      return {
        signature: {
          created: true,
          importedMarkdown: true,
          exported: typeof exportResult.json?.markdown === 'string',
        },
        recoverableErrors: 0,
      }
    },
  },
  {
    id: 'queue-controls',
    name: 'Queue pause/retry/edit parity',
    estimatedKeystrokes: 32,
    run: async (client) => {
      const conversationId = `parity-queue-${randomSuffix()}`
      const enqueue = await client.post('/v1/queue', {
        content: 'queue parity message',
        conversationId,
      })
      if (!enqueue.ok || !enqueue.json?.message?.id) {
        throw new Error(`Queue enqueue failed (${enqueue.status}): ${enqueue.text}`)
      }

      const messageId = enqueue.json.message.id
      const pause = await client.post(`/v1/queue/${encodeURIComponent(conversationId)}/pause`, {})
      const edit = await client.patch(`/v1/queue/${encodeURIComponent(messageId)}`, {
        conversationId,
        content: 'queue parity message edited',
      })
      const retry = await client.post(`/v1/queue/${encodeURIComponent(messageId)}/retry`, { conversationId })
      const resume = await client.post(`/v1/queue/${encodeURIComponent(conversationId)}/resume`, {})
      const clear = await client.post('/v1/queue/clear', { conversationId })

      if (!pause.ok || !edit.ok || !retry.ok || !resume.ok || !clear.ok) {
        throw new Error('Queue parity operations failed')
      }

      return {
        signature: {
          paused: pause.json?.isPaused === true,
          resumed: resume.json?.isPaused === false,
          retryCount: retry.json?.message?.retryCount || 0,
        },
        recoverableErrors: 0,
      }
    },
  },
  {
    id: 'agent-session-controls',
    name: 'Agent sessions/snooze parity',
    estimatedKeystrokes: 18,
    run: async (client) => {
      const list = await client.get('/v1/agent-sessions?includeSnoozed=true')
      if (!list.ok || !list.json) {
        throw new Error(`Session list failed (${list.status}): ${list.text}`)
      }

      let recoverableErrors = 0
      const session = Array.isArray(list.json.sessions) ? list.json.sessions[0] : null
      if (session?.sessionId) {
        const snooze = await client.post(`/v1/agent-sessions/${encodeURIComponent(session.sessionId)}/snooze`, {})
        const unsnooze = await client.post(`/v1/agent-sessions/${encodeURIComponent(session.sessionId)}/unsnooze`, {})
        if (!snooze.ok || !unsnooze.ok) {
          throw new Error('Session snooze/unsnooze operation failed')
        }
      } else {
        recoverableErrors += 1
      }

      return {
        signature: {
          activeCount: list.json.activeCount || 0,
          hasSnoozeField: !!Array.isArray(list.json.sessions),
        },
        recoverableErrors,
      }
    },
  },
  {
    id: 'oauth-elicitation-sampling',
    name: 'OAuth + elicitation/sampling parity',
    estimatedKeystrokes: 16,
    run: async (client) => {
      const elicitation = await client.get('/v1/elicitation/pending')
      const sampling = await client.get('/v1/sampling/pending')
      if (!elicitation.ok || !sampling.ok) {
        throw new Error('Elicitation or sampling endpoint failed')
      }

      return {
        signature: {
          pendingElicitationCount: Array.isArray(elicitation.json?.pending) ? elicitation.json.pending.length : 0,
          pendingSamplingCount: Array.isArray(sampling.json?.pending) ? sampling.json.pending.length : 0,
        },
        recoverableErrors: 0,
      }
    },
  },
  {
    id: 'terminal-equivalent-integrations',
    name: 'Tunnel/WhatsApp/TTS terminal-equivalent parity',
    estimatedKeystrokes: 24,
    run: async (client) => {
      const whatsappStatus = await client.get('/v1/whatsapp/status')
      const tunnelStatus = await client.get('/v1/tunnels/status')
      const tunnelList = await client.get('/v1/tunnels/list')

      if (!whatsappStatus.ok || !tunnelStatus.ok) {
        throw new Error('WhatsApp or tunnel status endpoint failed')
      }

      let recoverableErrors = 0
      let ttsAvailable = true

      if (process.env.PARITY_ENABLE_TTS !== 'false') {
        const tts = await client.post('/v1/tts/generate', {
          text: process.env.PARITY_TTS_TEXT || 'Parity terminal equivalent TTS check.',
        })
        if (!tts.ok) {
          ttsAvailable = false
          recoverableErrors += 1
        }
      }

      if (!tunnelList.ok) {
        recoverableErrors += 1
      }

      return {
        signature: {
          whatsappStatusAvailable: typeof whatsappStatus.json?.available === 'boolean',
          tunnelStatusAvailable: typeof tunnelStatus.json?.running === 'boolean',
          ttsAvailable,
        },
        recoverableErrors,
      }
    },
  },
]

const smokeScenarioIds = new Set([
  'settings-roundtrip',
  'memories-crud',
  'queue-controls',
  'agent-session-controls',
])

const selectedScenarios = mode === 'smoke'
  ? scenarios.filter((scenario) => smokeScenarioIds.has(scenario.id))
  : scenarios

async function runScenarioPair(scenario) {
  const desktopClient = makeClient(desktopTarget)
  const cliClient = makeClient(cliTarget)

  const startedAt = Date.now()
  const desktopResult = await scenario.run(desktopClient)
  const cliResult = await scenario.run(cliClient)
  const durationMs = Date.now() - startedAt

  const desktopSignature = sortedStringify(desktopResult.signature)
  const cliSignature = sortedStringify(cliResult.signature)
  const parityMatch = desktopSignature === cliSignature

  const recoverableErrors = (desktopResult.recoverableErrors || 0) + (cliResult.recoverableErrors || 0)

  return {
    passed: parityMatch,
    durationMs,
    estimatedKeystrokes: scenario.estimatedKeystrokes,
    recoverableErrors,
    desktopSignature: desktopResult.signature,
    cliSignature: cliResult.signature,
  }
}

async function main() {
  ensureDir(reportDir)
  ensureDir(uxLogDir)

  const preflightDesktop = await requestJson(desktopTarget, 'GET', '/v1/settings')
  const preflightCli = await requestJson(cliTarget, 'GET', '/v1/settings')
  const preflightFailures = []

  if (!preflightDesktop.ok) {
    preflightFailures.push(`desktop target preflight failed (${preflightDesktop.status}): ${preflightDesktop.text}`)
  }
  if (!preflightCli.ok) {
    preflightFailures.push(`cli target preflight failed (${preflightCli.status}): ${preflightCli.text}`)
  }

  if (preflightFailures.length > 0) {
    console.error('[parity] Preflight failed:')
    for (const failure of preflightFailures) {
      console.error(`  - ${failure}`)
    }
    if (!parityApiKey) {
      console.error('[parity] Hint: set SPEAKMCP_PARITY_API_KEY (or SPEAKMCP_API_KEY) for authenticated server runs.')
    }
    process.exit(1)
  }

  const scenarioReports = []
  let totalRuns = 0
  let totalPassedRuns = 0

  for (const scenario of selectedScenarios) {
    const runResults = []

    for (let i = 0; i < runsPerScenario; i++) {
      let runResult
      try {
        runResult = await runScenarioPair(scenario)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        runResult = {
          passed: false,
          durationMs: 0,
          estimatedKeystrokes: scenario.estimatedKeystrokes,
          recoverableErrors: 1,
          error: message,
          desktopSignature: null,
          cliSignature: null,
        }
      }

      runResults.push(runResult)
      totalRuns += 1
      if (runResult.passed) totalPassedRuns += 1

      const logLine = {
        timestamp: nowIso(),
        mode,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        run: i + 1,
        durationMs: runResult.durationMs,
        estimatedKeystrokes: runResult.estimatedKeystrokes,
        recoverableErrors: runResult.recoverableErrors,
        passed: runResult.passed,
      }
      fs.appendFileSync(uxLogPath, `${JSON.stringify(logLine)}\n`)
    }

    const durations = runResults.map((run) => run.durationMs)
    const recoverableErrorCount = runResults.reduce((sum, run) => sum + (run.recoverableErrors || 0), 0)
    const passRate = runResults.length > 0
      ? runResults.filter((run) => run.passed).length / runResults.length
      : 0

    scenarioReports.push({
      id: scenario.id,
      name: scenario.name,
      estimatedKeystrokes: scenario.estimatedKeystrokes,
      runs: runResults,
      passRate,
      duration: {
        minMs: durations.length ? Math.min(...durations) : 0,
        maxMs: durations.length ? Math.max(...durations) : 0,
        avgMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
        stdDevMs: Math.round(stdDev(durations)),
      },
      recoverableErrorCount,
    })
  }

  const summary = {
    mode,
    generatedAt: nowIso(),
    runsPerScenario,
    targets: {
      desktop: desktopTarget,
      cli: cliTarget,
    },
    totalScenarios: selectedScenarios.length,
    totalRuns,
    passedRuns: totalPassedRuns,
    passRate: totalRuns > 0 ? totalPassedRuns / totalRuns : 0,
    scenarioFailureCount: scenarioReports.filter((scenario) => scenario.passRate < 1).length,
    totalRecoverableErrors: scenarioReports.reduce((sum, scenario) => sum + scenario.recoverableErrorCount, 0),
  }

  const report = {
    summary,
    scenarios: scenarioReports,
  }

  const jsonPath = mode === 'full'
    ? path.resolve(reportDir, 'parity-report.json')
    : path.resolve(reportDir, 'parity-smoke-report.json')

  const mdPath = mode === 'full'
    ? path.resolve(reportDir, 'parity-report.md')
    : path.resolve(reportDir, 'parity-smoke-report.md')

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))

  const markdownLines = [
    `# CLI Parity ${mode === 'full' ? 'Full' : 'Smoke'} Report`,
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Runs per scenario: ${summary.runsPerScenario}`,
    `- Desktop target: \`${summary.targets.desktop}\``,
    `- CLI target: \`${summary.targets.cli}\``,
    `- Overall pass rate: ${(summary.passRate * 100).toFixed(1)}% (${summary.passedRuns}/${summary.totalRuns})`,
    `- Scenario failures: ${summary.scenarioFailureCount}`,
    `- Recoverable errors: ${summary.totalRecoverableErrors}`,
    '',
    '## Scenario Results',
    '',
    '| Scenario | Pass Rate | Avg Duration (ms) | Duration StdDev (ms) | Recoverable Errors |',
    '| --- | ---: | ---: | ---: | ---: |',
  ]

  for (const scenario of scenarioReports) {
    markdownLines.push(
      `| ${scenario.name} | ${(scenario.passRate * 100).toFixed(1)}% | ${scenario.duration.avgMs} | ${scenario.duration.stdDevMs} | ${scenario.recoverableErrorCount} |`,
    )
  }

  markdownLines.push('', '## Scenario Run Details', '')

  for (const scenario of scenarioReports) {
    markdownLines.push(`### ${scenario.name}`)
    markdownLines.push('')
    for (const run of scenario.runs) {
      markdownLines.push(
        `- Run: ${run.passed ? 'PASS' : 'FAIL'} | duration=${run.durationMs}ms | keystrokes=${run.estimatedKeystrokes} | recoverableErrors=${run.recoverableErrors || 0}`,
      )
      if (run.error) {
        markdownLines.push(`  error: ${run.error}`)
      }
    }
    markdownLines.push('')
  }

  fs.writeFileSync(mdPath, `${markdownLines.join('\n')}\n`)

  console.log(`[parity] Completed ${mode} run.`)
  console.log(`[parity] JSON report: ${jsonPath}`)
  console.log(`[parity] Markdown report: ${mdPath}`)
  console.log(`[parity] UX log: ${uxLogPath}`)

  if (summary.scenarioFailureCount > 0) {
    process.exitCode = 1
  }
}

await main()
