/**
 * env-check.ts — Node.js replacement for the environment-checker agent.
 * Checks prerequisites for the Next.js full-stack project.
 */

import { spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
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

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) vars[m[1]] = m[2]
  }
  return vars
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

function checkNodeVersion(): CheckResult {
  const r = sh('node --version 2>/dev/null')
  if (r.ok) {
    const major = parseInt(r.stdout.replace('v', '').split('.')[0], 10)
    if (major >= 20) return { name: 'Node >= 20', status: 'PASS', notes: r.stdout }
    return { name: 'Node >= 20', status: 'FAIL', notes: `${r.stdout} — need >= 20`, fix: 'nvm install 20 && nvm use 20' }
  }
  return { name: 'Node >= 20', status: 'FAIL', notes: 'node not found on PATH', fix: 'nvm install 20 && nvm use 20' }
}

function checkEnvFile(projectRoot: string): CheckResult {
  const localEnv  = join(projectRoot, '.env.local')
  const envFile   = join(projectRoot, '.env')
  if (existsSync(localEnv) || existsSync(envFile)) {
    return { name: '.env.local present', status: 'PASS', notes: 'environment file found' }
  }
  return {
    name: '.env.local present', status: 'FAIL',
    notes: 'neither .env.local nor .env found in project root',
    fix:   'cp .env.example .env.local and fill in DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET',
  }
}

function checkEnvVars(projectRoot: string): CheckResult[] {
  const localEnv = join(projectRoot, '.env.local')
  const envFile  = join(projectRoot, '.env')
  const path     = existsSync(localEnv) ? localEnv : envFile
  const envVars  = readEnvFile(path)

  return ['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'].map(key => {
    if (envVars[key]) return { name: key, status: 'PASS' as const, notes: 'present' }
    return {
      name: key, status: 'FAIL' as const,
      notes: `missing from ${existsSync(localEnv) ? '.env.local' : '.env'}`,
      fix:   `Add ${key} to .env.local`,
    }
  })
}

function checkAppDeps(projectRoot: string): CheckResult {
  if (existsSync(join(projectRoot, 'node_modules', 'next'))) {
    return { name: 'App deps installed', status: 'PASS', notes: 'node_modules/next found' }
  }
  return {
    name: 'App deps installed', status: 'FAIL',
    notes: 'node_modules/next missing',
    fix:   'pnpm install',
  }
}

function checkPrismaGenerated(projectRoot: string): CheckResult {
  const clientDir = join(projectRoot, 'node_modules', '.prisma', 'client')
  const altDir    = join(projectRoot, 'node_modules', '@prisma', 'client')
  if (existsSync(clientDir) || existsSync(altDir)) {
    return { name: 'Prisma client generated', status: 'PASS', notes: '' }
  }
  return {
    name: 'Prisma client generated', status: 'WARN',
    notes: '.prisma/client not found — run pnpm db:generate after setting DATABASE_URL',
    fix:   'pnpm db:generate',
  }
}

function checkDocker(): CheckResult {
  const r = sh('docker info 2>/dev/null')
  if (!r.ok) {
    return {
      name: 'Docker running', status: 'WARN',
      notes: 'Docker daemon not reachable — skipping container checks',
    }
  }
  return { name: 'Docker running', status: 'PASS', notes: 'daemon reachable' }
}

function checkDbConnection(projectRoot: string): CheckResult {
  const localEnv = join(projectRoot, '.env.local')
  const envFile  = join(projectRoot, '.env')
  const path     = existsSync(localEnv) ? localEnv : envFile
  const envVars  = readEnvFile(path)
  // process.env.DATABASE_URL takes precedence — set by loadDotEnv from orchestrator's .env if present
  const url      = process.env.DATABASE_URL ?? envVars['DATABASE_URL']

  if (!url || url.includes('USER:PASSWORD')) {
    return { name: 'DB connection', status: 'WARN', notes: 'DATABASE_URL not set — skipping connectivity check' }
  }

  const r = sh(`node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: '${url}' });
    c.connect().then(() => c.end()).then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null`)

  if (r.ok && r.stdout.includes('OK')) {
    return { name: 'DB connection', status: 'PASS', notes: 'PostgreSQL reachable' }
  }
  return {
    name: 'DB connection', status: 'FAIL',
    notes: `cannot connect: ${(r.stderr || r.stdout).slice(0, 120)}`,
    fix:   'Ensure the database is running and DATABASE_URL is correct',
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
    checkPnpm(),
    checkNodeVersion(),
    checkEnvFile(projectRoot),
    ...checkEnvVars(projectRoot),
    checkAppDeps(projectRoot),
    checkPrismaGenerated(projectRoot),
    checkDocker(),
    checkDbConnection(projectRoot),
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
