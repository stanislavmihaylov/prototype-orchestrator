#!/usr/bin/env tsx
/**
 * Checkpoint helper for the pipeline orchestrator.
 *
 * Commands:
 *   start   <threadId> <node> <agentName> <model>
 *   finish  <threadId> <node> <status> <total_tokens|0> <duration_ms|0> [cost_usd] [input] [cache_write] [cache_read] [output]
 *   preview <threadId> <node> <preview_file>
 *   error   <threadId> <node> <...error_message>
 *   state   <threadId> <key> <...value>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { BLENDED_RATE, computeCost, modelTier } from './common/pricing'
import { DATA_DIR, RUNS_DIR, INTERACTIONS_DIR, FEEDBACK_DIR } from './common/paths'

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function runPath(threadId: string): string {
  return join(RUNS_DIR, `${threadId}.json`)
}

function load(threadId: string): any {
  try {
    return JSON.parse(readFileSync(runPath(threadId), 'utf8'))
  } catch (e: any) {
    console.error(`[checkpoint] failed to load ${runPath(threadId)}: ${e.message}`)
    process.exit(1)
  }
}

function save(d: any, threadId: string): void {
  d.updatedAt = nowIso()
  writeFileSync(runPath(threadId), JSON.stringify(d, null, 2))
}

function findNode(d: any, nodeName: string): any {
  return [...d.nodes].reverse().find((n: any) => n.node === nodeName) ?? null
}

function recomputeTotals(d: any): void {
  const nodes: any[] = d.nodes ?? []
  let totalTokens = 0, totalCost = 0
  let inputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0, outputTokens = 0
  let totalDurationMs = 0

  for (const n of nodes) {
    if (n.status !== 'success' && n.status !== 'failed') continue
    totalTokens     += n.totalTokens    ?? 0
    totalCost       += n.costUsd        ?? 0
    inputTokens     += n.inputTokens    ?? 0
    cacheWriteTokens += n.cacheWriteTokens ?? 0
    cacheReadTokens += n.cacheReadTokens ?? 0
    outputTokens    += n.outputTokens   ?? 0
    totalDurationMs += n.durationMs     ?? 0
  }

  d.totals = {
    totalTokens,
    costUsd: Math.round(totalCost * 10000) / 10000,
    inputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
    totalDurationMs,
    updatedAt: nowIso(),
  }
}

const [, , cmd, ...args] = process.argv

if (cmd === 'create') {
  // create <threadId> <featureSlug> [pid]
  // Atomically check for an existing active run and create a new one if none found.
  // Prints: EXISTING_RUN:<existingId>:<status>  OR  CREATED:<threadId>
  const [threadId, featureSlug, rawPid] = args
  const orchestratorPid = rawPid ? parseInt(rawPid, 10) : null
  mkdirSync(RUNS_DIR, { recursive: true })

  const activeStatuses = ['running', 'waiting_interrupt_1', 'waiting_interrupt_2']
  let files: string[]
  try { files = readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json')) } catch { files = [] }

  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8'))
      if (d.state?.featureSlug === featureSlug && activeStatuses.includes(d.state?.status)) {
        console.log(`EXISTING_RUN:${d.threadId}:${d.state.status}`)
        process.exit(0)
      }
    } catch { /* skip unreadable */ }
  }

  const now = nowIso()
  const d = {
    threadId,
    pid: orchestratorPid,
    createdAt: now,
    updatedAt: now,
    state: {
      flowName: featureSlug,
      featureSlug,
      featureDescription: '',
      scope: 'auto',
      status: 'running',
      errorMessage: '',
      iteration: 0,
      featurePlan: '',
      planFeedback: '',
      openQuestions: [] as string[],
      questionAnswers: {} as Record<string, string>,
      reviewSeverity: 'clean',
    },
    nodes: [] as any[],
    totals: {
      totalTokens: 0, costUsd: 0, inputTokens: 0,
      cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0,
      totalDurationMs: 0, updatedAt: now,
    },
  }
  writeFileSync(runPath(threadId), JSON.stringify(d, null, 2))
  console.log(`CREATED:${threadId}`)

} else if (cmd === 'start') {
  const [threadId, node, agentName, model, rawPid] = args
  const agentPid = rawPid ? parseInt(rawPid, 10) : null
  const d = load(threadId)

  // Mark any existing running nodes for this step as stale before adding a new one.
  // This prevents duplicate running entries when a session restarts mid-step.
  for (const n of d.nodes) {
    if (n.node === node && n.status === 'running') {
      n.status = 'stale'
      n.completedAt = nowIso()
      n.durationMs = n.startedAt ? Date.now() - new Date(n.startedAt).getTime() : null
    }
  }

  d.nodes.push({
    node,
    agentName,
    model,
    pid: agentPid,
    startedAt: nowIso(),
    completedAt: null,
    durationMs: null,
    totalTokens: null,
    inputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    outputTokens: null,
    costUsd: null,
    status: 'running',
    error: null,
    outputPreview: null,
  })
  save(d, threadId)
  console.log(`[checkpoint] ${node} → running`)

} else if (cmd === 'finish') {
  const [
    threadId, node, status,
    rawTotal   = '0',
    rawDur     = '0',
    rawCost    = '',
    rawInput   = '',
    rawCw      = '',
    rawCr      = '',
    rawOutput  = '',
    rawAgentPid = '',
  ] = args
  const agentPid = rawAgentPid && rawAgentPid !== '0' ? parseInt(rawAgentPid, 10) : null

  const totalTokens   = rawTotal  && rawTotal  !== '0' ? parseInt(rawTotal,  10) : null
  const durationMsArg = rawDur    && rawDur    !== '0' ? parseInt(rawDur,    10) : null
  const inputTokens   = rawInput  && rawInput  !== '0' ? parseInt(rawInput,  10) : null
  const cwTokens      = rawCw     && rawCw     !== '0' ? parseInt(rawCw,     10) : null
  const crTokens      = rawCr     && rawCr     !== '0' ? parseInt(rawCr,     10) : null
  const outTokens     = rawOutput && rawOutput !== '0' ? parseInt(rawOutput, 10) : null

  const explicitCost = rawCost && rawCost !== '0' && rawCost !== '0.0' && rawCost !== '0.0000'
    ? parseFloat(rawCost)
    : null

  const d = load(threadId)
  const n = findNode(d, node)
  if (n) {
    n.status = status
    n.completedAt = nowIso()
    if (agentPid !== null) n.pid = agentPid

    n.durationMs = durationMsArg !== null
      ? durationMsArg
      : (() => { try { return Date.now() - new Date(n.startedAt).getTime() } catch { return null } })()

    if (totalTokens !== null) {
      n.totalTokens = totalTokens
      n.inputTokens      = inputTokens
      n.cacheWriteTokens = cwTokens
      n.cacheReadTokens  = crTokens
      n.outputTokens     = outTokens

      if (explicitCost !== null) {
        n.costUsd = Math.round(explicitCost * 10000) / 10000
      } else if (inputTokens !== null && outTokens !== null) {
        n.costUsd = Math.round(computeCost(n.model ?? '', inputTokens, cwTokens ?? 0, crTokens ?? 0, outTokens) * 10000) / 10000
      } else {
        // Blended fallback using tier rate
        const tier = modelTier(n.model ?? '')
        const blended = BLENDED_RATE[tier] ?? BLENDED_RATE.sonnet
        n.costUsd = Math.round(totalTokens * blended / 1_000_000 * 10000) / 10000
      }
    }
  }

  recomputeTotals(d)
  save(d, threadId)
  console.log(`[checkpoint] ${node} → ${status} | tokens=${totalTokens} cost=$${n?.costUsd?.toFixed(4) ?? '?'} dur=${n?.durationMs ?? '?'}ms`)

} else if (cmd === 'preview') {
  const [threadId, node, previewFile] = args
  let text = ''
  try { text = readFileSync(previewFile, 'utf8').slice(0, 300) } catch { /* not found */ }
  const d = load(threadId)
  const n = findNode(d, node)
  if (n) n.outputPreview = text
  save(d, threadId)
  console.log(`[checkpoint] ${node} preview set (${text.length} chars)`)

} else if (cmd === 'error') {
  const [threadId, node, ...rest] = args
  const d = load(threadId)
  const n = findNode(d, node)
  if (n) n.error = rest.join(' ')
  save(d, threadId)
  console.log(`[checkpoint] ${node} error recorded`)

} else if (cmd === 'state') {
  const [threadId, key, ...rest] = args
  const d = load(threadId)
  d.state[key] = rest.join(' ')
  save(d, threadId)
  console.log(`[checkpoint] state.${key} = ${rest.join(' ')}`)

} else if (cmd === 'interaction-start') {
  const [threadId, rawNum] = args
  mkdirSync(INTERACTIONS_DIR, { recursive: true })
  const ipath = join(INTERACTIONS_DIR, `${threadId}.json`)
  const d = existsSync(ipath)
    ? JSON.parse(readFileSync(ipath, 'utf8'))
    : { threadId, interactions: [], totals: {} }
  const num = parseInt(rawNum, 10)
  // Remove stale pending entry for this interrupt number (re-plan loop)
  d.interactions = d.interactions.filter((i: any) => !(i.interruptNumber === num && i.respondedAt === null))
  d.interactions.push({
    interruptNumber: num,
    presentedAt: nowIso(),
    respondedAt: null,
    waitDurationMs: null,
    type: null,
    text: null,
    totalTokens: null,
    inputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    outputTokens: null,
    costUsd: null,
  })
  writeFileSync(ipath, JSON.stringify(d, null, 2))
  console.log(`[checkpoint] interaction ${num} started`)

} else if (cmd === 'interaction-finish') {
  // interaction-finish <threadId> <interruptNumber> <type> <input> <cw> <cr> <output> <cost> [text...]
  const [threadId, rawNum, type, rawInput, rawCw, rawCr, rawOutput, rawCost, ...textParts] = args
  const ipath = join(INTERACTIONS_DIR, `${threadId}.json`)
  if (!existsSync(ipath)) { console.error('[checkpoint] interactions file not found'); process.exit(1) }
  const d = JSON.parse(readFileSync(ipath, 'utf8'))
  const num = parseInt(rawNum, 10)

  const inputTokens   = rawInput  && rawInput  !== '0' ? parseInt(rawInput,  10) : null
  const cwTokens      = rawCw     && rawCw     !== '0' ? parseInt(rawCw,     10) : null
  const crTokens      = rawCr     && rawCr     !== '0' ? parseInt(rawCr,     10) : null
  const outTokens     = rawOutput && rawOutput !== '0' ? parseInt(rawOutput, 10) : null
  const totalTokens   = (inputTokens ?? 0) + (cwTokens ?? 0) + (crTokens ?? 0) + (outTokens ?? 0) || null
  const explicitCost  = rawCost && rawCost !== '0' ? parseFloat(rawCost) : null
  const costUsd = explicitCost !== null
    ? Math.round(explicitCost * 10000) / 10000
    : (totalTokens ? Math.round(computeCost('sonnet', inputTokens ?? 0, cwTokens ?? 0, crTokens ?? 0, outTokens ?? 0) * 10000) / 10000 : null)

  // Find the last pending entry for this interrupt number
  const entry = [...d.interactions].reverse().find((i: any) => i.interruptNumber === num && i.respondedAt === null)
  if (entry) {
    entry.respondedAt   = nowIso()
    entry.waitDurationMs = entry.presentedAt ? Date.now() - new Date(entry.presentedAt).getTime() : null
    entry.type          = type
    entry.text          = textParts.join(' ') || null
    entry.totalTokens   = totalTokens
    entry.inputTokens   = inputTokens
    entry.cacheWriteTokens = cwTokens
    entry.cacheReadTokens  = crTokens
    entry.outputTokens  = outTokens
    entry.costUsd       = costUsd
  }

  // Recompute totals
  const done = d.interactions.filter((i: any) => i.respondedAt !== null)
  d.totals = {
    totalTokens:      done.reduce((s: number, i: any) => s + (i.totalTokens ?? 0), 0),
    costUsd:          Math.round(done.reduce((s: number, i: any) => s + (i.costUsd ?? 0), 0) * 10000) / 10000,
    inputTokens:      done.reduce((s: number, i: any) => s + (i.inputTokens ?? 0), 0),
    cacheWriteTokens: done.reduce((s: number, i: any) => s + (i.cacheWriteTokens ?? 0), 0),
    cacheReadTokens:  done.reduce((s: number, i: any) => s + (i.cacheReadTokens ?? 0), 0),
    outputTokens:     done.reduce((s: number, i: any) => s + (i.outputTokens ?? 0), 0),
    updatedAt: nowIso(),
  }

  writeFileSync(ipath, JSON.stringify(d, null, 2))
  console.log(`[checkpoint] interaction ${num} → ${type} | tokens=${totalTokens} cost=$${costUsd?.toFixed(4) ?? '?'}`)

} else if (cmd === 'feedback') {
  // feedback <threadId> <type: review_finding|plan_rejection> <featureSlug> <agent> <...description>
  // Creates/overwrites orchestrator_logs/logs/feedback/<threadId>-<type>.json
  const [threadId, type, featureSlug, agent, ...descParts] = args
  const description = descParts.join(' ').slice(0, 500)
  mkdirSync(FEEDBACK_DIR, { recursive: true })
  const fpath = join(FEEDBACK_DIR, `${threadId}-${type}.json`)
  const entry = {
    feature_slug: featureSlug,
    date: new Date().toISOString().slice(0, 10),
    agent,
    feedback_type: type,
    description,
    resolution: 'pending',
  }
  writeFileSync(fpath, JSON.stringify(entry, null, 2))
  console.log(`[checkpoint] feedback ${type} written for ${featureSlug}`)

} else if (cmd === 'feedback-resolve') {
  // feedback-resolve <threadId> <type: review_finding|plan_rejection> <...resolution>
  const [threadId, type, ...resParts] = args
  const resolution = resParts.join(' ') || 'resolved'
  const fpath = join(FEEDBACK_DIR, `${threadId}-${type}.json`)
  try {
    const entry = JSON.parse(readFileSync(fpath, 'utf8'))
    entry.resolution = resolution
    writeFileSync(fpath, JSON.stringify(entry, null, 2))
    console.log(`[checkpoint] feedback ${type} resolved: ${resolution}`)
  } catch {
    console.error(`[checkpoint] feedback file not found: ${fpath}`)
  }

} else {
  console.log('Usage: checkpoint-helper.ts <create|start|finish|preview|error|state|feedback|feedback-resolve|interaction-start|interaction-finish> [args...]')
  process.exit(1)
}
