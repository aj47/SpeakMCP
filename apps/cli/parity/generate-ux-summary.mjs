#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'

const logsDir = path.join(os.homedir(), '.speakmcp', 'logs')
const logPath = path.join(logsDir, 'cli-ux-regression.jsonl')
const summaryPath = path.join(logsDir, 'cli-ux-weekly-summary.md')
const windowDays = Number(process.env.PARITY_UX_SUMMARY_DAYS || '7')

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
  const records = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line))
    } catch {
      // Ignore invalid JSONL lines.
    }
  }
  return records
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const records = readJsonl(logPath)
const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
const scopedRecords = records.filter((record) => {
  const ts = new Date(record.timestamp || 0).getTime()
  return Number.isFinite(ts) && ts >= cutoff
})

const grouped = new Map()
for (const record of scopedRecords) {
  const key = record.scenarioId || 'unknown'
  if (!grouped.has(key)) {
    grouped.set(key, {
      scenarioName: record.scenarioName || key,
      runs: 0,
      durations: [],
      keystrokes: [],
      recoverableErrors: 0,
      passes: 0,
    })
  }

  const group = grouped.get(key)
  group.runs += 1
  group.durations.push(Number(record.durationMs) || 0)
  group.keystrokes.push(Number(record.estimatedKeystrokes) || 0)
  group.recoverableErrors += Number(record.recoverableErrors) || 0
  if (record.passed) group.passes += 1
}

const summaryLines = [
  '# CLI UX Regression Weekly Summary',
  '',
  `- Generated: ${new Date().toISOString()}`,
  `- Window: last ${windowDays} day(s)`,
  `- Source log: \`${logPath}\``,
  '',
]

if (grouped.size === 0) {
  summaryLines.push('No UX regression records found for the selected time window.')
} else {
  const allRuns = Array.from(grouped.values()).reduce((sum, group) => sum + group.runs, 0)
  const allRecoverable = Array.from(grouped.values()).reduce((sum, group) => sum + group.recoverableErrors, 0)
  const allPasses = Array.from(grouped.values()).reduce((sum, group) => sum + group.passes, 0)
  const overallPassRate = allRuns > 0 ? (allPasses / allRuns) * 100 : 0

  summaryLines.push(`- Total runs: ${allRuns}`)
  summaryLines.push(`- Overall pass rate: ${overallPassRate.toFixed(1)}%`)
  summaryLines.push(`- Recoverable errors: ${allRecoverable}`)
  summaryLines.push('')
  summaryLines.push('## Per Scenario')
  summaryLines.push('')
  summaryLines.push('| Scenario | Runs | Pass Rate | Avg Duration (ms) | Avg Keystrokes | Recoverable Errors |')
  summaryLines.push('| --- | ---: | ---: | ---: | ---: | ---: |')

  for (const [, group] of grouped.entries()) {
    const passRate = group.runs > 0 ? (group.passes / group.runs) * 100 : 0
    summaryLines.push(
      `| ${group.scenarioName} | ${group.runs} | ${passRate.toFixed(1)}% | ${Math.round(average(group.durations))} | ${Math.round(average(group.keystrokes))} | ${group.recoverableErrors} |`,
    )
  }
}

fs.mkdirSync(logsDir, { recursive: true })
fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`)

console.log(`[parity:ux:summary] Generated summary: ${summaryPath}`)
