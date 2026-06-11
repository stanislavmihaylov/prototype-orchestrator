#!/usr/bin/env tsx
/**
 * pipeline.ts — Standalone Node.js SDLC pipeline orchestrator.
 *
 * Usage (from project root or via ./pipeline):
 *   tsx prototype-orchestrator/src/pipeline.ts start "Feature Name" [--scope backend|mobile|both]
 *   tsx prototype-orchestrator/src/pipeline.ts resume <threadId>
 *
 * Interaction modes:
 *   TTY (./pipeline start ...):  interrupt prompts appear inline in the terminal
 *   Headless (spawned by dashboard):  interrupt responses are read from response files
 *                                     written by the dashboard UI
 */

import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import * as readline from 'readline'
import { computeCost } from './common/pricing'
import { runEnvCheck } from './env-check'
import { createPr } from './pr-manager'

// Load prototype-orchestrator/.env before any process.env reads (existing vars take precedence)
;(function loadDotEnv() {
  const envPath = join(resolve(__dirname, '..'), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
})()

// ─── Paths ────────────────────────────────────────────────────────────────────

const ORCH_DIR      = resolve(__dirname, '..')
const PROJECT_ROOT  = resolve(ORCH_DIR, '..')           // prototype-orchestrator/ sits at the repo root
const CLAUDE_DIR    = join(PROJECT_ROOT, '.claude')
const TSX           = join(ORCH_DIR, 'node_modules', '.bin', 'tsx')
const CHECKPOINT    = join(__dirname, 'checkpoint-helper.ts')
const NOTIFY        = join(__dirname, 'notify.ts')
const DATA_DIR      = process.env.PIPELINE_DATA_DIR ? resolve(ORCH_DIR, process.env.PIPELINE_DATA_DIR) : ORCH_DIR
const RUNS_DIR      = join(DATA_DIR, 'runs')
const RESPONSES_DIR = join(DATA_DIR, 'responses')

if (!existsSync(CLAUDE_DIR)) {
  console.error(`[orchestrator] FATAL: .claude directory not found at ${CLAUDE_DIR}`)
  console.error('The prototype-orchestrator/ folder must sit next to .claude/ in the repo root.')
  process.exit(1)
}

// Detect if we're running attached to a terminal
const IS_TTY = Boolean(process.stdout.isTTY)

// When false: skip Figma env check and design-analyst-flow step (proposal-based projects)
const HAS_DESIGN = process.env.HAS_DESIGN !== 'false'

// When true: skip the environment-checker step entirely (useful in CI or pre-validated envs)
const SKIP_ENV_CHECK = process.env.SKIP_ENV_CHECK === 'true'

// ─── Agent model assignments ──────────────────────────────────────────────────

const AGENT_MODEL_DEFAULTS: Record<string, string> = {
  'design-analyst-flow':            'claude-sonnet-4-6',
  'plan-feature':                   'claude-sonnet-4-6',
  'feature-implementation-backend': 'claude-sonnet-4-6',
  'feature-implementation-frontend':'claude-sonnet-4-6',
  'test-runner':                    'claude-sonnet-4-6',
  'reviewer':                       'claude-opus-4-8',
}

function loadPipelineConfig(): Record<string, string> {
  const configPath = join(ORCH_DIR, 'pipeline.config.json')
  if (!existsSync(configPath)) return { ...AGENT_MODEL_DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    const overrides: Record<string, string> = {}
    for (const [agent, cfg] of Object.entries(raw.agents ?? {})) {
      const model = typeof cfg === 'string' ? cfg : (cfg as any).model
      if (model) overrides[agent] = model
    }
    return { ...AGENT_MODEL_DEFAULTS, ...overrides }
  } catch (err) {
    console.warn(`[orchestrator] Failed to parse pipeline.config.json: ${err instanceof Error ? err.message : err}`)
    return { ...AGENT_MODEL_DEFAULTS }
  }
}

const AGENT_MODELS: Record<string, string> = loadPipelineConfig()

// ─── Checkpoint helper shim ───────────────────────────────────────────────────

function ch(...args: string[]): string {
  const r = spawnSync(TSX, [CHECKPOINT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    cwd: ORCH_DIR,
  })
  if (r.error) console.warn(`[checkpoint] spawn error: ${r.error.message}`)
  return (r.stdout ?? '').trim()
}

// ─── Notifications ────────────────────────────────────────────────────────────

function notify(title: string, body: string, level: 'info' | 'warning' | 'error', threadId: string): void {
  spawnSync(TSX, [NOTIFY, title, body, level, threadId], {
    encoding: 'utf8',
    stdio: 'inherit',
    cwd: ORCH_DIR,
    env: { ...process.env },
  })
}

// ─── Agent runner ─────────────────────────────────────────────────────────────

interface AgentResult {
  output: string
  costUsd: number
  durationMs: number
  isError: boolean
  pid?: number
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  totalTokens: number
}

function runAgent(agentName: string, prompt: string): AgentResult {
  const model = AGENT_MODELS[agentName] ?? 'claude-sonnet-4-6'
  const startMs = Date.now()

  console.log(`\n[pipeline] → ${agentName} (${model})`)

  const r = spawnSync('claude', [
    '--agent', agentName,
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--permission-mode', 'bypassPermissions',
    prompt,
  ], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const durationMs = Date.now() - startMs

  if (r.error) throw new Error(`Agent ${agentName} spawn error: ${r.error.message}`)

  let output = ''
  let inputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0, outputTokens = 0
  let costUsd = 0

  for (const line of (r.stdout ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed)
      if (event.type === 'assistant' && event.message?.usage) {
        const u = event.message.usage
        inputTokens      += u.input_tokens                  ?? 0
        cacheWriteTokens += u.cache_creation_input_tokens   ?? 0
        cacheReadTokens  += u.cache_read_input_tokens       ?? 0
        outputTokens     += u.output_tokens                 ?? 0
      } else if (event.type === 'result') {
        if (event.result)   output  = event.result
        if (event.cost_usd) costUsd = event.cost_usd
        if (event.usage) {
          const u = event.usage
          if (u.input_tokens)                inputTokens      = u.input_tokens
          if (u.cache_creation_input_tokens) cacheWriteTokens = u.cache_creation_input_tokens
          if (u.cache_read_input_tokens)     cacheReadTokens  = u.cache_read_input_tokens
          if (u.output_tokens)               outputTokens     = u.output_tokens
        }
      }
    } catch { /* non-JSON line, skip */ }
  }

  const totalTokens = inputTokens + cacheWriteTokens + cacheReadTokens + outputTokens
  if (!costUsd && totalTokens > 0) {
    costUsd = computeCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens)
  }

  return { output, costUsd, durationMs, isError: r.status !== 0, pid: r.pid ?? undefined,
    inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, totalTokens }
}

// ─── Transient error detection + retry ───────────────────────────────────────

const TRANSIENT_PATTERNS = [
  /api error/i,
  /socket connection was closed/i,
  /connection error/i,
  /econnreset/i,
  /network error/i,
  /fetch failed/i,
  /overloaded/i,
]

function isTransientError(r: AgentResult): boolean {
  if (r.isError) return true
  if (!r.output.trim()) return true  // exit 0 but no output = silent API failure, worth retrying
  return TRANSIENT_PATTERNS.some(p => p.test(r.output))
}

async function runAgentWithRetry(agentName: string, prompt: string, maxRetries = 2): Promise<AgentResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delaySec = 10 * attempt
      console.log(`\n[pipeline] ${agentName} transient error — retrying in ${delaySec}s (attempt ${attempt + 1}/${maxRetries + 1})`)
      await new Promise(r => setTimeout(r, delaySec * 1000))
    }
    const r = runAgent(agentName, prompt)
    if (!isTransientError(r)) return r
    console.warn(`[pipeline] transient error from ${agentName}: ${r.output.slice(0, 200) || '(empty output)'}`)
    if (attempt === maxRetries) return r
  }
  return runAgent(agentName, prompt) // unreachable; satisfies TS
}

// ─── Checkpoint finish helper ─────────────────────────────────────────────────

function finishNode(threadId: string, node: string, r: AgentResult, succeeded: boolean): void {
  ch('finish', threadId, node, succeeded ? 'success' : 'failed',
    String(r.totalTokens || 0), '0', String(r.costUsd || 0),
    String(r.inputTokens || 0), String(r.cacheWriteTokens || 0),
    String(r.cacheReadTokens || 0), String(r.outputTokens || 0),
    String(r.pid || 0))
}

// ─── Thread ID ────────────────────────────────────────────────────────────────

function newThreadId(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
         `${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`
}

// ─── Human input — TTY mode (readline) ───────────────────────────────────────

function askHuman(prompt: string): Promise<string> {
  return new Promise(res => {
    process.stdout.write(prompt + '\n> ')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    let done = false
    rl.once('line', line => { done = true; rl.close(); res(line.trim()) })
    rl.once('close', () => { if (!done) res('') })
  })
}

// ─── Human input — headless mode (file polling) ──────────────────────────────

function waitForResponseFile(threadId: string, key: string): Promise<string> {
  mkdirSync(RESPONSES_DIR, { recursive: true })
  const path = join(RESPONSES_DIR, `${threadId}-${key}.json`)
  // Remove stale response from a previous session
  try { unlinkSync(path) } catch { /* no file, that's fine */ }

  return new Promise(resolve => {
    const check = () => {
      if (existsSync(path)) {
        try {
          const data = JSON.parse(readFileSync(path, 'utf8'))
          unlinkSync(path)
          resolve(data.response)
          return
        } catch { /* corrupt file, retry */ }
      }
      setTimeout(check, 2000)
    }
    setTimeout(check, 2000)
  })
}

function getResponse(threadId: string, key: string, terminalPrompt: string): Promise<string> {
  return IS_TTY ? askHuman(terminalPrompt) : waitForResponseFile(threadId, key)
}

// ─── Checkpoint state reader ──────────────────────────────────────────────────

function loadRun(threadId: string): any {
  return JSON.parse(readFileSync(join(RUNS_DIR, `${threadId}.json`), 'utf8'))
}

// ─── Pipeline steps ───────────────────────────────────────────────────────────

async function stepEnvironmentCheck(threadId: string, featureSlug: string): Promise<void> {
  ch('start', threadId, 'environment_check', 'node:env-check', 'n/a')
  const startMs = Date.now()
  const { passed, summary } = runEnvCheck(PROJECT_ROOT, featureSlug)
  const durationMs = Date.now() - startMs

  console.log('\n' + summary)

  const fakeResult: AgentResult = {
    output: summary, costUsd: 0, durationMs, isError: false,
    inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0,
  }
  finishNode(threadId, 'environment_check', fakeResult, passed)

  if (!passed) {
    ch('error', threadId, 'environment_check', summary.slice(0, 2000))
    ch('state', threadId, 'status', 'failed')
    ch('state', threadId, 'errorMessage', 'Environment check failed')
    notify('Pipeline failed', 'Environment check failed.', 'error', threadId)
    throw new Error(`Environment not ready:\n${summary}`)
  }
}

async function stepDesignAnalystFlow(threadId: string, flowName: string): Promise<{ featureSlug: string; featureDescription: string }> {
  ch('start', threadId, 'design_analyst_flow', 'design-analyst-flow', AGENT_MODELS['design-analyst-flow'])
  const r = runAgent('design-analyst-flow', `flow_name: ${flowName}`)
  const designPassed = !r.isError && !r.output.includes('FIGMA_MCP_FAILED:') && r.output.includes('feature_slug:')
  finishNode(threadId, 'design_analyst_flow', r, designPassed)

  if (!designPassed) {
    const msg = r.output.match(/FIGMA_MCP_FAILED:(.*)/)?.[1]?.trim()
      ?? (r.output.toLowerCase().includes('figma') ? 'Figma MCP not available — ensure the MCP server is configured and running' : 'design-analyst-flow failed — check Figma MCP')
    // Store full agent output in the node error so the dashboard shows verbose context
    ch('error', threadId, 'design_analyst_flow', r.output.slice(0, 1200))
    ch('state', threadId, 'status', 'failed')
    ch('state', threadId, 'errorMessage', msg)
    notify('Pipeline failed', msg, 'error', threadId)
    throw new Error(`${msg}\n${r.output}`)
  }

  const featureSlug        = r.output.match(/feature_slug:\s*(.+)/)?.[1]?.trim()        ?? ''
  const featureDescription = r.output.match(/feature_description:\s*(.+)/)?.[1]?.trim() ?? ''

  ch('state', threadId, 'featureSlug',        featureSlug)
  ch('state', threadId, 'featureDescription', featureDescription)

  const previewFile = `/tmp/preview-design-${threadId}.txt`
  writeFileSync(previewFile, r.output.slice(0, 300))
  ch('preview', threadId, 'design_analyst_flow', previewFile)

  return { featureSlug, featureDescription }
}

async function stepPlanFeature(
  threadId: string,
  featureSlug: string,
  featureDescription: string,
  planFeedback = '',
  questionAnswers: Record<string, string> = {},
  implementationFeedback = '',
  existingPlan = '',
): Promise<{ plan: string; scope: string; openQuestions: string[] }> {
  ch('start', threadId, 'plan_feature', 'plan-feature', AGENT_MODELS['plan-feature'])

  let prompt = `Feature: ${featureSlug}\nDescription: ${featureDescription}`

  if (implementationFeedback) {
    prompt += `\n\nExisting approved plan:\n${existingPlan}`
    prompt += `\n\nfix: ${implementationFeedback}`
  } else if (planFeedback) {
    prompt += `\n\nPrevious plan rejected with feedback:\n${planFeedback}`
  }

  if (Object.keys(questionAnswers).length > 0) {
    prompt += '\n\nAnswers to open questions:\n' +
      Object.entries(questionAnswers).map(([q, a], i) => `${i + 1}. ${q} → ${a}`).join('\n')
  }

  const r = await runAgentWithRetry('plan-feature', prompt)
  const planOk = !isTransientError(r) && r.output.length > 200
  finishNode(threadId, 'plan_feature', r, planOk)

  if (!planOk) {
    ch('error', threadId, 'plan_feature', r.output.slice(0, 500) || 'plan-feature returned empty output')
    ch('state', threadId, 'status', 'failed')
    ch('state', threadId, 'errorMessage', 'plan-feature failed — check network or API key')
    notify('Pipeline failed', 'plan-feature agent failed after retries.', 'error', threadId)
    throw new Error(`plan-feature failed:\n${r.output}`)
  }

  // Store full plan (up to 50k chars — enough for any plan)
  ch('state', threadId, 'featurePlan',  r.output.slice(0, 50000))
  ch('state', threadId, 'planFeedback', '')

  const scopeMatch = r.output.match(/\*\*Scope:\*\*\s*`?(both|backend|mobile)`?/i)
  const scope = scopeMatch?.[1]?.toLowerCase() ?? 'both'
  ch('state', threadId, 'scope', scope)

  const oqSection = r.output.match(/###\s*5\.\s*Open Questions([\s\S]*?)(?=###|$)/i)?.[1] ?? ''
  const openQuestions: string[] = []
  if (!oqSection.toLowerCase().includes('no open questions')) {
    for (const m of oqSection.matchAll(/\d+\.\s*(.+)/g)) openQuestions.push(m[1].trim())
  }

  return { plan: r.output, scope, openQuestions }
}

async function stepImplementBackend(
  threadId: string, featureSlug: string, featureDescription: string, plan: string, extra = '',
): Promise<AgentResult> {
  ch('start', threadId, 'backend_implementation', 'feature-implementation-backend', AGENT_MODELS['feature-implementation-backend'])
  const r = await runAgentWithRetry('feature-implementation-backend',
    `Feature: ${featureSlug}\nDescription: ${featureDescription}\n\nApproved plan:\n${plan}${extra ? '\n\n' + extra : ''}`)
  finishNode(threadId, 'backend_implementation', r, !r.isError)
  return r
}

async function stepImplementFrontend(
  threadId: string, featureSlug: string, featureDescription: string, plan: string, extra = '',
): Promise<AgentResult> {
  ch('start', threadId, 'frontend_implementation', 'feature-implementation-frontend', AGENT_MODELS['feature-implementation-frontend'])
  const r = await runAgentWithRetry('feature-implementation-frontend',
    `Feature: ${featureSlug}\nDescription: ${featureDescription}\n\nApproved plan:\n${plan}${extra ? '\n\n' + extra : ''}`)
  finishNode(threadId, 'frontend_implementation', r, !r.isError)
  return r
}

async function stepTests(threadId: string, scope: string, featureSlug: string): Promise<AgentResult> {
  ch('start', threadId, 'test_runner', 'test-runner', AGENT_MODELS['test-runner'])
  const scopeArg = scope === 'backend' ? 'backend' : scope === 'mobile' ? 'mobile' : 'full'
  const r = runAgent('test-runner', `Scope: ${scopeArg}. Run all tests for feature: ${featureSlug}`)
  finishNode(threadId, 'test_runner', r, !r.isError)
  return r
}

async function stepReview(
  threadId: string, scope: string, featureSlug: string,
): Promise<{ result: AgentResult; severity: string }> {
  ch('start', threadId, 'reviewer', 'reviewer', AGENT_MODELS['reviewer'])
  const scopeArg = scope === 'backend' ? 'backend' : scope === 'mobile' ? 'mobile' : 'full'
  const r = await runAgentWithRetry('reviewer', `Scope: ${scopeArg}. Review feature: ${featureSlug}`)
  finishNode(threadId, 'reviewer', r, true)

  const severity = r.output.match(/^REVIEW_RESULT:\s*(critical|high|clean)/m)?.[1] ?? 'clean'
  ch('state', threadId, 'reviewSeverity', severity)

  if (severity === 'critical' || severity === 'high') {
    ch('feedback', threadId, 'review_finding', featureSlug, 'reviewer',
      `Review found ${severity} issues: ${r.output.slice(0, 200)}`)
  }
  return { result: r, severity }
}

async function stepPrManager(threadId: string, featureSlug: string, featureDescription: string): Promise<void> {
  ch('start', threadId, 'pr_manager', 'node:pr-manager', 'n/a')
  const startMs = Date.now()

  let succeeded = false
  let output = ''
  try {
    const result = createPr(PROJECT_ROOT, featureSlug, featureDescription)
    output = `PR ${result.alreadyExisted ? 'already exists' : 'created'}: ${result.url}\nTitle: ${result.title}`
    succeeded = true
  } catch (err) {
    output = err instanceof Error ? err.message : String(err)
    console.error(`[pipeline] pr-manager error: ${output}`)
  }

  const durationMs = Date.now() - startMs
  const fakeResult: AgentResult = {
    output, costUsd: 0, durationMs, isError: !succeeded,
    inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0,
  }
  const previewFile = `/tmp/preview-pr-manager-${threadId}.txt`
  writeFileSync(previewFile, output.slice(0, 300))
  finishNode(threadId, 'pr_manager', fakeResult, succeeded)
  ch('preview', threadId, 'pr_manager', previewFile)

  if (!succeeded) {
    ch('state', threadId, 'status', 'failed')
    ch('state', threadId, 'errorMessage', output.slice(0, 200))
    notify('Pipeline failed', `PR creation failed: ${output.slice(0, 120)}`, 'error', threadId)
    throw new Error(`PR creation failed:\n${output}`)
  }

  // Mark feature complete in tasks.md — done here in pipeline code so it's
  // deterministic and never silently skipped by the agent.
  markTaskComplete(featureSlug)

  const path = join(RUNS_DIR, `${threadId}.json`)
  const d = JSON.parse(readFileSync(path, 'utf8'))
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  d.state.status = 'done'
  d.completedAt = now
  d.updatedAt   = now
  writeFileSync(path, JSON.stringify(d, null, 2))

  notify(`Pipeline complete: ${featureSlug}`, 'PR created. Feature marked done.', 'info', threadId)
  console.log(`\nDone. PR created for ${featureSlug}.`)
}

function markTaskComplete(featureSlug: string): void {
  const tasksPath = join(PROJECT_ROOT, 'docs', 'blueprint', 'tasks.md')
  if (!existsSync(tasksPath)) return

  const original = readFileSync(tasksPath, 'utf8')
  // Matches: - [ ] `feature-slug` — ...  (the top-level backlog line)
  const updated = original.replace(
    new RegExp(`(- )\\[ \\]( \`${featureSlug}\`)`),
    '$1[x]$2'
  )
  if (updated === original) {
    console.log(`[pipeline] tasks.md: no unchecked entry found for "${featureSlug}" — skipping`)
    return
  }

  writeFileSync(tasksPath, updated)
  spawnSync('git', ['add', 'docs/blueprint/tasks.md'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
  const commit = spawnSync('git', ['commit', '-m', `chore: mark ${featureSlug} complete in tasks.md`], { cwd: PROJECT_ROOT, encoding: 'utf8' })
  if (commit.status === 0) {
    spawnSync('git', ['push'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
    console.log(`[pipeline] tasks.md: marked "${featureSlug}" [x] and pushed`)
  } else {
    console.warn(`[pipeline] tasks.md: updated but git commit failed — ${commit.stderr}`)
  }
}

// ─── Open questions ───────────────────────────────────────────────────────────

async function resolveOpenQuestions(
  threadId: string,
  featureDescription: string,
  openQuestions: string[],
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {}

  ch('state', threadId, 'openQuestions', JSON.stringify(openQuestions))
  ch('state', threadId, 'status', 'waiting_interrupt_1')

  if (IS_TTY) {
    console.log(`\n${'━'.repeat(55)}`)
    console.log(`QUESTIONS — ${openQuestions.length} clarification(s) needed`)
    console.log(`Feature: ${featureDescription}`)
    console.log('━'.repeat(55))
    for (let i = 0; i < openQuestions.length; i++) {
      const answer = await askHuman(`Q${i + 1}  ${openQuestions[i]}\n    ►`)
      answers[openQuestions[i]] = answer
    }
  } else {
    // Dashboard mode: wait for all answers in one response payload
    // Dashboard sends: JSON.stringify({ answers: { [q]: answer, ... } })
    const raw = await waitForResponseFile(threadId, 'q')
    const parsed = JSON.parse(raw)
    Object.assign(answers, parsed.answers ?? parsed)
  }

  ch('state', threadId, 'questionAnswers', JSON.stringify(answers))
  ch('state', threadId, 'openQuestions', '[]')
  ch('state', threadId, 'status', 'running')
  return answers
}

// ─── Interrupt #1 — plan review ───────────────────────────────────────────────

async function interrupt1(
  threadId: string,
  featureDescription: string,
  plan: string,
  questionAnswers: Record<string, string>,
): Promise<string> {
  ch('state', threadId, 'status', 'waiting_interrupt_1')
  ch('interaction-start', threadId, '1')
  notify('Interrupt #1 — Review plan',
    `Feature: ${featureDescription}. Plan ready for review.`, 'info', threadId)

  if (IS_TTY) {
    const planPreview = plan.slice(0, 4000) + (plan.length > 4000 ? '\n...(truncated — full plan in dashboard)' : '')
    const qaLines = Object.entries(questionAnswers).map(([q, a]) => `  Q: ${q}\n  A: ${a}`).join('\n')
    console.log(`
${'━'.repeat(55)}
INTERRUPT #1 — Review plan
Feature: ${featureDescription}
${'━'.repeat(55)}
${planPreview}
${qaLines ? `\nAnswered questions:\n${qaLines}` : ''}
${'━'.repeat(55)}
Reply "approved" to proceed, or describe what needs to change.`)
  } else {
    console.log(`[pipeline] Waiting for interrupt #1 (plan review) — ${featureDescription}`)
  }

  const response = await getResponse(threadId, '1',
    'Reply "approved" to proceed, or describe what needs to change.')
  const type = response.toLowerCase() === 'approved' ? 'approved' : 'feedback'
  ch('interaction-finish', threadId, '1', type, '0', '0', '0', '0', '0', response.slice(0, 500))
  return response
}

// ─── Interrupt #2 — merge approval ───────────────────────────────────────────

interface Interrupt2Result { decision: 'merge' | 'hold' | 'fix'; feedback: string }

async function interrupt2(
  threadId: string,
  featureDescription: string,
  testsOk: boolean,
  severity: string,
  iteration: number,
): Promise<Interrupt2Result> {
  ch('state', threadId, 'status', 'waiting_interrupt_2')
  ch('interaction-start', threadId, '2')
  const level = (severity === 'critical' || severity === 'high') ? 'warning' : 'info'
  notify('Interrupt #2 — Approve merge',
    'All checks complete. Review results and reply merge, hold, or fix: <feedback>.', level, threadId)

  if (IS_TTY) {
    console.log(`
${'━'.repeat(55)}
INTERRUPT #2 — Approve merge
Feature: ${featureDescription}

Tests:           ${testsOk ? '✓' : '✗'}
Review:          ${severity}
Auto-fix rounds: ${iteration}
${'━'.repeat(55)}
Reply "merge" to create the PR, "hold" to pause, or "fix: <feedback>" to re-run implementation.`)
  } else {
    console.log(`[pipeline] Waiting for interrupt #2 (merge approval) — ${featureDescription}`)
  }

  const response = await getResponse(threadId, '2', 'Reply "merge", "hold", or "fix: <feedback>":')
  const text = response.trim()
  let decision: 'merge' | 'hold' | 'fix'
  let feedback = ''
  if (text.toLowerCase() === 'merge') {
    decision = 'merge'
  } else if (text.toLowerCase().startsWith('fix:') || text.toLowerCase().startsWith('fix ')) {
    decision = 'fix'
    feedback = text.slice(4).trim()
  } else {
    decision = 'hold'
  }
  const recordType = decision === 'merge' ? 'merge' : decision === 'fix' ? 'feedback' : 'hold'
  ch('interaction-finish', threadId, '2', recordType, '0', '0', '0', '0', '0', text.slice(0, 500))
  if (decision === 'fix' && feedback) {
    ch('feedback', threadId, 'implementation_fix_request', featureDescription.replace(/\s+/g, '-').toLowerCase().slice(0, 40), 'user',
      `User requested implementation fixes: ${feedback.slice(0, 400)}`)
  }
  return { decision, feedback }
}

// ─── Core pipeline execution ──────────────────────────────────────────────────

interface State {
  threadId: string; flowName: string; featureSlug: string; featureDescription: string
  scope: string; plan: string; planFeedback: string; iteration: number
  questionAnswers: Record<string, string>
}

async function executePipeline(s: State): Promise<void> {
  let { threadId, flowName, featureSlug, featureDescription, scope, plan, planFeedback, iteration, questionAnswers } = s

  try {
    if (!SKIP_ENV_CHECK) await stepEnvironmentCheck(threadId, featureSlug)

    if (HAS_DESIGN) {
      const design = await stepDesignAnalystFlow(threadId, flowName)
      if (design.featureSlug)        featureSlug        = design.featureSlug
      if (design.featureDescription) featureDescription = design.featureDescription
    }

    // Plan + questions + interrupt #1 (with re-plan loop)
    let planApproved = false
    while (!planApproved) {
      const planResult = await stepPlanFeature(threadId, featureSlug, featureDescription, planFeedback, questionAnswers)
      plan  = planResult.plan
      scope = scope === 'auto' ? planResult.scope : scope

      // If there are open questions, collect answers then loop back so plan-feature
      // can incorporate them into a refined plan before Interrupt #1.
      if (planResult.openQuestions.length > 0) {
        questionAnswers = await resolveOpenQuestions(threadId, featureDescription, planResult.openQuestions)
        planFeedback = '' // don't re-show prior feedback on the re-run
        continue
      }

      const response = await interrupt1(threadId, featureDescription, plan, questionAnswers)
      if (response.toLowerCase() === 'approved') {
        ch('state', threadId, 'status', 'running')
        planApproved = true
      } else {
        planFeedback = response
        ch('state', threadId, 'planFeedback', planFeedback)
        ch('feedback', threadId, 'plan_rejection', featureSlug, 'plan-feature',
          `Plan rejected. Feedback: ${planFeedback}`)
      }
    }

    const qaContext = Object.keys(questionAnswers).length > 0
      ? 'Answers to open questions:\n' +
        Object.entries(questionAnswers).map(([q, a], i) => `${i + 1}. ${q} → ${a}`).join('\n')
      : ''

    // Implement → test → review, with one auto-fix round
    let testsOk = false, reviewSeverity = 'clean', reviewOutput = ''

    const runRound = async (fixContext = '') => {
      const extra = fixContext || qaContext
      if (scope !== 'mobile')  await stepImplementBackend(threadId,  featureSlug, featureDescription, plan, extra)
      if (scope !== 'backend') await stepImplementFrontend(threadId, featureSlug, featureDescription, plan, extra)
      const testResult   = await stepTests(threadId, scope, featureSlug)
      const reviewResult = await stepReview(threadId, scope, featureSlug)
      testsOk        = !testResult.isError
      reviewSeverity = reviewResult.severity
      reviewOutput   = reviewResult.result.output
    }

    await runRound()

    if ((reviewSeverity === 'critical' || reviewSeverity === 'high') && iteration < 1) {
      console.log(`\n[pipeline] Review found ${reviewSeverity} issues — running auto-fix (1/1).`)
      const critSection = reviewOutput.match(/##\s*Critical[\s\S]*?(?=##|$)/i)?.[0] ?? ''
      const highSection = reviewOutput.match(/##\s*High[\s\S]*?(?=##|$)/i)?.[0] ?? ''
      const fixContext  = `REVIEWER FINDINGS TO FIX (iteration 1/1):\n${(critSection + '\n' + highSection).slice(0, 1500)}`
      iteration = 1
      ch('state', threadId, 'iteration', '1')
      await runRound(fixContext)
      ch('feedback-resolve', threadId, 'review_finding', 'resolved after 1 iteration')
    }

    let mergeDecisionDone = false
    while (!mergeDecisionDone) {
      const { decision, feedback } = await interrupt2(threadId, featureDescription, testsOk, reviewSeverity, iteration)
      if (decision === 'merge') {
        ch('state', threadId, 'status', 'running')
        await stepPrManager(threadId, featureSlug, featureDescription)
        mergeDecisionDone = true
      } else if (decision === 'fix') {
        ch('state', threadId, 'status', 'running')
        console.log(`\n[pipeline] Re-planning based on Interrupt #2 feedback, then re-implementing.`)
        const replanResult = await stepPlanFeature(
          threadId, featureSlug, featureDescription, '', questionAnswers, feedback, plan)
        plan = replanResult.plan
        if (replanResult.scope !== 'both') scope = replanResult.scope
        iteration = 0
        ch('state', threadId, 'iteration', '0')
        await runRound()
      } else {
        ch('state', threadId, 'status', 'aborted')
        console.log(`\nPipeline held. Resume with:\n  ./pipeline resume ${threadId}`)
        mergeDecisionDone = true
      }
    }

  } catch (err) {
    console.error('\n[pipeline] Fatal:', err instanceof Error ? err.message : err)
    ch('state', threadId, 'status', 'failed')
    throw err
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function startPipeline(flowName: string, scopeOverride?: string): Promise<void> {
  if (!existsSync(join(PROJECT_ROOT, 'docs', 'blueprint', 'index.md'))) {
    throw new Error('Blueprint missing — run design-discovery first and check docs/blueprint/index.md')
  }

  const featureSlug = flowName.toLowerCase().replace(/\s+/g, '-')
  const threadId    = newThreadId()
  const createResult = ch('create', threadId, featureSlug, String(process.pid))
  console.log(createResult)

  if (createResult.startsWith('EXISTING_RUN:')) {
    const [, existingId, status] = createResult.split(':')
    console.log(`\nA run for "${flowName}" is already active (thread: ${existingId}, status: ${status}).`)
    console.log(`Use "./pipeline resume ${existingId}" to continue it.`)

    if (IS_TTY) {
      const ans = await askHuman('Type "fresh" to abort it and start over, or press Enter to cancel:')
      if (ans.toLowerCase() !== 'fresh') { console.log('Cancelled.'); return }
    } else {
      // Dashboard handles conflict before calling start — if we get here just abort and continue
    }
    ch('state', existingId, 'status', 'aborted')
    const freshId = newThreadId()
    ch('create', freshId, featureSlug, String(process.pid))
    console.log(`Pipeline started — thread: ${freshId}`)
    await executePipeline({ threadId: freshId, flowName, featureSlug, featureDescription: '', scope: scopeOverride ?? 'auto', plan: '', planFeedback: '', iteration: 0, questionAnswers: {} })
    return
  }

  const actualThreadId = createResult.replace('CREATED:', '')
  console.log(`Pipeline started — thread: ${actualThreadId}`)
  await executePipeline({ threadId: actualThreadId, flowName, featureSlug, featureDescription: '', scope: scopeOverride ?? 'auto', plan: '', planFeedback: '', iteration: 0, questionAnswers: {} })
}

// ─── Resume ───────────────────────────────────────────────────────────────────

async function resumePipeline(threadId: string): Promise<void> {
  // Stamp the current orchestrator PID so the dashboard reflects which process owns this run
  const runFilePath = join(RUNS_DIR, `${threadId}.json`)
  const runData = JSON.parse(readFileSync(runFilePath, 'utf8'))
  runData.pid = process.pid
  runData.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  writeFileSync(runFilePath, JSON.stringify(runData, null, 2))

  const run   = loadRun(threadId)
  const state = run.state

  switch (state.status) {
    case 'done':
      console.log(`Pipeline ${threadId} is already complete.`); return

    case 'aborted':
      console.log(`Pipeline ${threadId} was held/aborted. Last state: ${state.featureSlug}`); return

    case 'failed': {
      const failedNode = [...run.nodes].reverse().find((n: any) => n.status === 'failed')
      console.log(`Pipeline ${threadId} failed at: ${failedNode?.node ?? 'unknown'}`)
      console.log(`Error: ${failedNode?.error ?? state.errorMessage ?? 'unknown'}`)
      return
    }

    case 'waiting_interrupt_1': {
      const qAnswers: Record<string, string> = typeof state.questionAnswers === 'string'
        ? JSON.parse(state.questionAnswers || '{}') : (state.questionAnswers ?? {})

      // If there are still unanswered questions, handle them first
      const openQs: string[] = typeof state.openQuestions === 'string'
        ? JSON.parse(state.openQuestions || '[]') : (state.openQuestions ?? [])
      if (openQs.length > 0) {
        const resolved = await resolveOpenQuestions(threadId, state.featureDescription, openQs)
        Object.assign(qAnswers, resolved)
      }

      const response = await interrupt1(threadId, state.featureDescription, state.featurePlan, qAnswers)
      if (response.toLowerCase() === 'approved') {
        ch('state', threadId, 'status', 'running')
        await continueFromImplementation(threadId, { ...state, questionAnswers: qAnswers })
      } else {
        ch('state', threadId, 'planFeedback', response)
        ch('feedback', threadId, 'plan_rejection', state.featureSlug, 'plan-feature',
          `Plan rejected. Feedback: ${response}`)
        console.log('Plan feedback saved. Re-run "resume" to re-plan.')
      }
      return
    }

    case 'waiting_interrupt_2': {
      const { decision, feedback } = await interrupt2(threadId, state.featureDescription, true, state.reviewSeverity, state.iteration ?? 0)
      if (decision === 'merge') {
        ch('state', threadId, 'status', 'running')
        await stepPrManager(threadId, state.featureSlug, state.featureDescription)
      } else if (decision === 'fix') {
        ch('state', threadId, 'status', 'running')
        await continueFromImplementation(threadId, loadRun(threadId).state, feedback)
      } else {
        ch('state', threadId, 'status', 'aborted')
        console.log(`Pipeline held. Resume with:\n  ./pipeline resume ${threadId}`)
      }
      return
    }

    case 'running': {
      const runningNode = [...run.nodes].reverse().find((n: any) => n.status === 'running')
      if (!runningNode) { console.log('No running node found.'); return }
      console.log(`Node '${runningNode.node}' (${runningNode.agentName}) was running when session ended.`)
      const choice = await getResponse(threadId, 'resume-choice',
        '(1) Re-run from start  (2) Mark failed & stop  (3) Mark succeeded & continue')
      switch (choice.trim()) {
        case '1':
          ch('finish', threadId, runningNode.node, 'failed', '0', '0', '0', '0', '0', '0', '0')
          console.log('Re-running from start not supported in resume — please use "start".')
          break
        case '2':
          ch('finish', threadId, runningNode.node, 'failed', '0', '0', '0', '0', '0', '0', '0')
          ch('state', threadId, 'status', 'failed')
          break
        case '3':
          ch('finish', threadId, runningNode.node, 'success', '0', '0', '0', '0', '0', '0', '0')
          await continueFromImplementation(threadId, loadRun(threadId).state)
          break
        default:
          console.log('Unrecognised choice. No changes made.')
      }
      return
    }

    default:
      console.log(`Unknown status: ${state.status}`)
  }
}

// ─── Rerun from failed step ───────────────────────────────────────────────────

async function rerunStep(threadId: string): Promise<void> {
  const runFilePath = join(RUNS_DIR, `${threadId}.json`)
  let runData = JSON.parse(readFileSync(runFilePath, 'utf8'))

  const failedNode = [...runData.nodes].reverse().find((n: any) => n.status === 'failed')
  if (!failedNode) {
    console.log(`[pipeline] No failed node found in run ${threadId}`)
    return
  }

  const nodeName: string = failedNode.node
  console.log(`\n[pipeline] Rerunning from failed node: ${nodeName}`)

  runData.pid = process.pid
  runData.state.status = 'running'
  runData.state.errorMessage = ''
  for (const n of runData.nodes) {
    if (n.node === nodeName && n.status === 'failed') n.status = 'stale'
  }
  runData.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  writeFileSync(runFilePath, JSON.stringify(runData, null, 2))

  const state = runData.state

  try {
    switch (nodeName) {
      case 'pr_manager':
        await stepPrManager(threadId, state.featureSlug, state.featureDescription)
        break

      case 'reviewer':
      case 'test_runner':
      case 'frontend_implementation':
      case 'backend_implementation':
        await continueFromImplementation(threadId, state)
        break

      case 'plan_feature': {
        const qAnswers: Record<string, string> = typeof state.questionAnswers === 'string'
          ? JSON.parse(state.questionAnswers || '{}') : (state.questionAnswers ?? {})
        const planResult = await stepPlanFeature(
          threadId, state.featureSlug, state.featureDescription, state.planFeedback ?? '', qAnswers)
        const plan = planResult.plan
        const scope = (state.scope && state.scope !== 'auto') ? state.scope : planResult.scope
        ch('state', threadId, 'scope', scope)
        const response = await interrupt1(threadId, state.featureDescription, plan, qAnswers)
        if (response.toLowerCase() === 'approved') {
          ch('state', threadId, 'status', 'running')
          await continueFromImplementation(threadId, loadRun(threadId).state)
        } else {
          ch('state', threadId, 'planFeedback', response)
          ch('feedback', threadId, 'plan_rejection', state.featureSlug, 'plan-feature',
            `Plan rejected. Feedback: ${response}`)
          console.log('Plan feedback saved. Rerun to re-plan.')
        }
        break
      }

      case 'environment_check': {
        await stepEnvironmentCheck(threadId, state.featureSlug)
        const freshState = loadRun(threadId).state
        const freshNodes: any[] = loadRun(threadId).nodes
        const designDone = !HAS_DESIGN || freshNodes.some((n: any) => n.node === 'design_analyst_flow' && n.status === 'success')
        if (designDone && freshState.featurePlan) {
          await continueFromImplementation(threadId, freshState)
        } else {
          console.log('[pipeline] Env check passed. Run ./pipeline resume ' + threadId + ' to continue.')
          ch('state', threadId, 'status', 'failed')
          ch('state', threadId, 'errorMessage', 'Env check passed — run ./pipeline resume to continue with design/plan')
        }
        break
      }

      default:
        console.log(`[pipeline] Rerun from ${nodeName} is not supported — use ./pipeline resume ${threadId}`)
        ch('state', threadId, 'status', 'failed')
        ch('state', threadId, 'errorMessage', `Rerun not available for ${nodeName} — use ./pipeline resume`)
    }
  } catch (err) {
    console.error('\n[pipeline] Fatal:', err instanceof Error ? err.message : err)
    ch('state', threadId, 'status', 'failed')
    throw err
  }
}

async function continueFromImplementation(threadId: string, state: any, implementationFeedback = ''): Promise<void> {
  const qAnswers: Record<string, string> = typeof state.questionAnswers === 'string'
    ? JSON.parse(state.questionAnswers || '{}') : (state.questionAnswers ?? {})
  const qaContext = Object.keys(qAnswers).length > 0
    ? 'Answers to open questions:\n' + Object.entries(qAnswers).map(([q, a], i) => `${i + 1}. ${q} → ${a}`).join('\n')
    : ''

  let plan = state.featurePlan ?? ''
  let testsOk = false, reviewSeverity = 'clean', reviewOutput = ''
  let iteration = parseInt(String(state.iteration)) || 0
  let scope = state.scope ?? 'both'

  // If called with Interrupt #2 feedback, re-run plan-feature first.
  if (implementationFeedback) {
    console.log(`\n[pipeline] Re-planning based on Interrupt #2 feedback, then re-implementing.`)
    const replanResult = await stepPlanFeature(
      threadId, state.featureSlug, state.featureDescription, '', qAnswers, implementationFeedback, plan)
    plan = replanResult.plan
    if (replanResult.scope !== 'both') scope = replanResult.scope
    iteration = 0
    ch('state', threadId, 'iteration', '0')
  }

  const runRound = async (fixContext = '') => {
    const extra = fixContext || qaContext
    if (scope !== 'mobile')  await stepImplementBackend(threadId,  state.featureSlug, state.featureDescription, plan, extra)
    if (scope !== 'backend') await stepImplementFrontend(threadId, state.featureSlug, state.featureDescription, plan, extra)
    const testResult   = await stepTests(threadId, scope, state.featureSlug)
    const reviewResult = await stepReview(threadId, scope, state.featureSlug)
    testsOk        = !testResult.isError
    reviewSeverity = reviewResult.severity
    reviewOutput   = reviewResult.result.output
  }

  await runRound()

  if ((reviewSeverity === 'critical' || reviewSeverity === 'high') && iteration < 1) {
    const critSection = reviewOutput.match(/##\s*Critical[\s\S]*?(?=##|$)/i)?.[0] ?? ''
    const highSection = reviewOutput.match(/##\s*High[\s\S]*?(?=##|$)/i)?.[0] ?? ''
    const fixContext  = `REVIEWER FINDINGS TO FIX (iteration 1/1):\n${(critSection + '\n' + highSection).slice(0, 1500)}`
    iteration = 1
    ch('state', threadId, 'iteration', '1')
    await runRound(fixContext)
    ch('feedback-resolve', threadId, 'review_finding', 'resolved after 1 iteration')
  }

  let mergeDecisionDone = false
  while (!mergeDecisionDone) {
    const { decision, feedback } = await interrupt2(threadId, state.featureDescription, testsOk, reviewSeverity, iteration)
    if (decision === 'merge') {
      ch('state', threadId, 'status', 'running')
      await stepPrManager(threadId, state.featureSlug, state.featureDescription)
      mergeDecisionDone = true
    } else if (decision === 'fix') {
      ch('state', threadId, 'status', 'running')
      console.log(`\n[pipeline] Re-planning based on Interrupt #2 feedback, then re-implementing.`)
      const replanResult = await stepPlanFeature(
        threadId, state.featureSlug, state.featureDescription, '', qAnswers, feedback, plan)
      plan = replanResult.plan
      if (replanResult.scope !== 'both') scope = replanResult.scope
      iteration = 0
      ch('state', threadId, 'iteration', '0')
      await runRound()
    } else {
      ch('state', threadId, 'status', 'aborted')
      console.log(`\nPipeline held. Resume with:\n  ./pipeline resume ${threadId}`)
      mergeDecisionDone = true
    }
  }
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv

  if (cmd === 'start') {
    const flowName = rest[0]
    if (!flowName) { console.error('Usage: pipeline start "<flow name>" [--scope backend|mobile|both]'); process.exit(1) }
    const scopeIdx = rest.indexOf('--scope')
    await startPipeline(flowName, scopeIdx >= 0 ? rest[scopeIdx + 1] : undefined)

  } else if (cmd === 'resume') {
    const threadId = rest[0]
    if (!threadId) { console.error('Usage: pipeline resume <threadId>'); process.exit(1) }
    await resumePipeline(threadId)

  } else if (cmd === 'rerun') {
    const threadId = rest[0]
    if (!threadId) { console.error('Usage: pipeline rerun <threadId>'); process.exit(1) }
    await rerunStep(threadId)

  } else {
    console.error('Usage:\n  pipeline start "<flow name>" [--scope backend|mobile|both]\n  pipeline resume <threadId>\n  pipeline rerun <threadId>')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('[pipeline] Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
