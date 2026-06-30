/**
 * env-check.ts — Checks prerequisites for the pipeline orchestrator.
 * Only verifies what the pipeline itself needs to run; stack-specific
 * checks (Prisma, DB, framework deps) are left to the implementation agents.
 */

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface CheckResult {
  name: string
  status: 'PASS' | 'FAIL' | 'WARN'
  notes: string
  fix?: string
}

export interface EnvCheckResult {
  passed: boolean
  results: CheckResult[]
  summary: string
}

function sh(cmd: string): { stdout: string; stderr: string; ok: boolean } {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 15_000 })
  return {
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    ok: r.status === 0,
  }
}

function checkNodeVersion(): CheckResult {
  const r = sh('node --version 2>/dev/null')
  if (r.ok) {
    const major = parseInt(r.stdout.replace('v', '').split('.')[0], 10)
    if (major >= 20) return { name: 'Node >= 20', status: 'PASS', notes: r.stdout }
    return { name: 'Node >= 20', status: 'FAIL', notes: `${r.stdout} — need >= 20`, fix: 'nvm install 20 && nvm use 20' }
  }
  return { name: 'Node >= 20', status: 'FAIL', notes: 'node not found on PATH', fix: 'nvm install 20 && nvm use 20' }
}

function checkPnpm(): CheckResult {
  const r = sh('pnpm --version 2>/dev/null')
  if (r.ok && r.stdout) {
    const major = parseInt(r.stdout.split('.')[0], 10)
    if (major >= 8) return { name: 'pnpm installed', status: 'PASS', notes: `v${r.stdout}` }
    return { name: 'pnpm installed', status: 'FAIL', notes: `v${r.stdout} — need >= 8.x`, fix: 'npm install -g pnpm' }
  }
  return { name: 'pnpm installed', status: 'FAIL', notes: 'not found on PATH', fix: 'npm install -g pnpm  OR  brew install pnpm' }
}

function checkDepsInstalled(projectRoot: string): CheckResult {
  if (existsSync(join(projectRoot, 'node_modules', '.bin'))) {
    return { name: 'Dependencies installed', status: 'PASS', notes: 'node_modules/.bin found' }
  }
  return {
    name: 'Dependencies installed', status: 'FAIL',
    notes: 'node_modules/.bin missing — run pnpm install',
    fix: 'pnpm install',
  }
}

function checkGitClean(projectRoot: string): CheckResult {
  const r = sh(`git -C "${projectRoot}" status --porcelain`)
  if (!r.stdout) return { name: 'Git tree clean', status: 'PASS', notes: 'clean' }
  const files = r.stdout.split('\n').filter(Boolean)
  return {
    name: 'Git tree clean', status: 'WARN',
    notes: `${files.length} uncommitted file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`,
  }
}

function checkFeatureBranch(projectRoot: string, featureSlug: string): CheckResult {
  const current = sh(`git -C "${projectRoot}" branch --show-current`)
  const target  = `feat/${featureSlug}`

  if (current.stdout !== 'main') {
    return { name: 'Feature branch', status: 'PASS', notes: `on branch '${current.stdout}'` }
  }

  const exists = sh(`git -C "${projectRoot}" show-ref --quiet "refs/heads/${target}" && echo EXISTS || echo MISSING`)
  if (exists.stdout === 'EXISTS') {
    const sw = sh(`git -C "${projectRoot}" checkout "${target}"`)
    if (sw.ok) return { name: 'Feature branch', status: 'PASS', notes: `switched to existing ${target}` }
    return { name: 'Feature branch', status: 'FAIL', notes: `could not switch to ${target}: ${sw.stderr}`, fix: `git checkout ${target}` }
  }

  sh(`git -C "${projectRoot}" pull origin main --quiet`)
  const create = sh(`git -C "${projectRoot}" checkout -b "${target}"`)
  if (create.ok) return { name: 'Feature branch', status: 'PASS', notes: `created ${target} from main` }
  return { name: 'Feature branch', status: 'FAIL', notes: `could not create ${target}: ${create.stderr}`, fix: `git checkout -b ${target}` }
}

export function runEnvCheck(projectRoot: string, featureSlug: string): EnvCheckResult {
  const results: CheckResult[] = [
    checkNodeVersion(),
    checkPnpm(),
    checkDepsInstalled(projectRoot),
    checkGitClean(projectRoot),
    checkFeatureBranch(projectRoot, featureSlug),
  ]

  const failures = results.filter(r => r.status === 'FAIL')
  const passed   = failures.length === 0

  const rows   = results.map(r => `| ${r.name.padEnd(30)} | ${r.status.padEnd(6)} | ${r.notes} |`).join('\n')
  const header = [
    '## Environment Check Results\n',
    '| Check                          | Status | Notes |',
    '|--------------------------------|--------|-------|',
    rows, '',
  ].join('\n')

  let summary: string
  if (passed) {
    summary = header + '## Result: ALL CHECKS PASSED (pipeline may proceed)\n'
  } else {
    const fixes = failures.map((f, i) => `${i + 1}. ${f.name}: ${f.fix ?? f.notes}`).join('\n')
    summary = header + '## Result: ENVIRONMENT NOT READY — fix the items marked FAIL before proceeding\n\n### Required fixes:\n' + fixes + '\n'
  }

  return { passed, results, summary }
}
