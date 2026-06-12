/**
 * pr-manager.ts — Node.js replacement for the pr-manager agent.
 * Verifies git state, pushes, generates PR body from commit log, and creates the PR.
 */

import { spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface PrResult {
  url: string
  title: string
  alreadyExisted: boolean
}

function sh(cmd: string, cwd: string): { stdout: string; stderr: string; ok: boolean } {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 60_000, cwd })
  return { stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim(), ok: r.status === 0 }
}

function git(args: string, cwd: string) {
  return sh(`git ${args}`, cwd)
}

function verifyCleanTree(projectRoot: string): void {
  // Use spawnSync directly — sh() trims the whole stdout which strips the leading space from the
  // first porcelain line, making fixed-position slicing unreliable.
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: projectRoot })
  const dirty = (r.stdout ?? '')
    .split('\n')
    .filter(l => {
      if (!l.trim()) return false
      const path = l.slice(3)  // skip XY (2 chars) + separator space
      return !path.startsWith('orchestrator_logs/') && path !== 'prototype-orchestrator'
    })
  if (dirty.length) throw new Error(`Uncommitted changes detected — please commit or stash before creating the PR:\n${dirty.join('\n')}`)
}

function verifyBranch(projectRoot: string): string {
  const r = git('branch --show-current', projectRoot)
  if (r.stdout === 'main' || r.stdout === 'master') {
    throw new Error(`Cannot create PR from '${r.stdout}'. Check out the feature branch first.`)
  }
  return r.stdout
}

function pushBranch(projectRoot: string, branch: string): void {
  const r = git(`push -u origin ${branch}`, projectRoot)
  if (!r.ok) throw new Error(`Push failed — do not force-push. Resolve diverged history first.\n${r.stderr}`)
}

function getCommitLog(projectRoot: string): string[] {
  const r = git('log main..HEAD --oneline', projectRoot)
  return r.stdout ? r.stdout.split('\n').filter(Boolean) : []
}

function readFeatureContext(projectRoot: string, featureSlug: string): { taskLine: string; flowSpec: string } {
  let taskLine = ''
  const tasksPath = join(projectRoot, 'docs/blueprint/tasks.md')
  if (existsSync(tasksPath)) {
    const line = readFileSync(tasksPath, 'utf8').split('\n').find(l => l.includes(`\`${featureSlug}\``))
    taskLine = line?.trim() ?? ''
  }
  let flowSpec = ''
  const flowPath = join(projectRoot, `docs/blueprint/flows/${featureSlug}.md`)
  if (existsSync(flowPath)) flowSpec = readFileSync(flowPath, 'utf8').slice(0, 1500)
  return { taskLine, flowSpec }
}

function detectScope(commits: string[]): string {
  const text = commits.join(' ').toLowerCase()
  const hasBackend = text.includes('backend') || text.includes('nest') || text.includes('migration')
  const hasMobile  = text.includes('mobile') || text.includes('react') || text.includes('screen')
  if (hasBackend && hasMobile) return 'mobile+backend'
  if (hasBackend) return 'backend'
  return 'mobile'
}

function buildPrTitle(featureSlug: string, featureDescription: string, scope: string): string {
  const desc = featureDescription || featureSlug.replace(/-/g, ' ')
  return `feat(${scope}): add ${desc}`
}

function buildPrBody(featureSlug: string, featureDescription: string, commits: string[]): string {
  const bullets = commits.slice(0, 6).map(c => `- ${c}`).join('\n') || '- (no commits)'
  const backendCommits = commits.filter(c => /backend|nest|migrat|service|controller/i.test(c))
  const mobileCommits  = commits.filter(c => /mobile|screen|store|component|nav/i.test(c))
  const typesCommits   = commits.filter(c => /types|dto|package/i.test(c))

  const strip = (c: string) => `- ${c.replace(/^[a-f0-9]+ /, '')}`
  const backendSection = backendCommits.length ? backendCommits.slice(0, 4).map(strip).join('\n') : '- (no backend changes)'
  const mobileSection  = mobileCommits.length  ? mobileCommits.slice(0, 4).map(strip).join('\n')  : '- (no mobile changes)'
  const typesSection   = typesCommits.length   ? typesCommits.slice(0, 2).map(strip).join('\n')   : '- (no shared type changes)'

  return `## Summary

${bullets}

## Changes

**Backend (\`apps/backend/\`):**
${backendSection}

**Mobile (\`apps/mobile/\`):**
${mobileSection}

**Shared types (\`packages/types/\`):**
${typesSection}

## Test plan

- [ ] Backend: \`pnpm --filter backend test\` — all passing
- [ ] Mobile: \`pnpm --filter mobile test\` — all passing
- [ ] Types build: \`pnpm --filter @repo/types build\` — PASS
- [ ] Lint: \`pnpm --filter backend lint && pnpm --filter mobile lint\` — PASS
- [ ] TypeScript: \`pnpm --filter mobile tsc --noEmit\` — PASS
- [ ] Manual smoke test: verify ${featureDescription || featureSlug} on device/simulator

## Screenshots

<!-- Add screenshots of the mobile UI here if available -->

## Breaking changes

- [ ] Yes — describe here
- [x] No

## Related tasks

- Closes: \`docs/blueprint/tasks.md\` — \`${featureSlug}\` task marked [x]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
`
}

function checkExistingPr(projectRoot: string): { url: string; title: string } | null {
  const r = sh('gh pr view --json url,title,state 2>/dev/null', projectRoot)
  if (!r.ok || !r.stdout) return null
  try {
    const pr = JSON.parse(r.stdout)
    if (pr.url) return { url: pr.url, title: pr.title }
  } catch { /* not JSON */ }
  return null
}

function commitUnstagedFeatureChanges(projectRoot: string, featureSlug: string): void {
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: projectRoot })
  const featureLines = (r.stdout ?? '').split('\n').filter(l => {
    if (!l.trim()) return false
    const p = l.slice(3)
    return !p.startsWith('orchestrator_logs/') && p !== 'prototype-orchestrator'
  })
  if (!featureLines.length) return
  console.log(`[pr-manager] Auto-committing ${featureLines.length} uncommitted file(s)…`)
  spawnSync('git', ['add', '-A'], { cwd: projectRoot, encoding: 'utf8' })
  // Unstage orchestrator_logs and the submodule — those get their own commit.
  spawnSync('git', ['reset', 'HEAD', '--', 'orchestrator_logs/', 'prototype-orchestrator'], {
    cwd: projectRoot, encoding: 'utf8',
  })
  const c = spawnSync('git', ['commit', '-m', `chore(${featureSlug}): commit remaining implementation changes`], {
    cwd: projectRoot, encoding: 'utf8',
  })
  if (c.status !== 0) console.warn(`[pr-manager] Auto-commit warning: ${(c.stderr ?? '').trim()}`)
}

function commitOrchestratorLogs(projectRoot: string): void {
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: projectRoot })
  const hasLogs = (r.stdout ?? '').split('\n').some(l => {
    const path = l.slice(3)
    return path.startsWith('orchestrator_logs/')
  })
  if (!hasLogs) return
  spawnSync('git', ['add', 'orchestrator_logs/'], { cwd: projectRoot, encoding: 'utf8' })
  spawnSync('git', ['commit', '-m', 'chore(orchestrator): update pipeline run logs'], {
    cwd: projectRoot, encoding: 'utf8',
  })
}

export function createPr(projectRoot: string, featureSlug: string, featureDescription: string): PrResult {
  const ghAuth = sh('gh auth status 2>&1', projectRoot)
  if (!ghAuth.ok) throw new Error('gh CLI is not authenticated. Run: gh auth login')

  commitUnstagedFeatureChanges(projectRoot, featureSlug)
  commitOrchestratorLogs(projectRoot)
  verifyCleanTree(projectRoot)
  const branch = verifyBranch(projectRoot)
  pushBranch(projectRoot, branch)

  const existing = checkExistingPr(projectRoot)
  if (existing) {
    console.log(`[pr-manager] PR already exists: ${existing.url}`)
    return { url: existing.url, title: existing.title, alreadyExisted: true }
  }

  const commits = getCommitLog(projectRoot)
  const { featureDescription: _fd } = { featureDescription }
  const scope = detectScope(commits)
  const title = buildPrTitle(featureSlug, featureDescription, scope)
  const body  = buildPrBody(featureSlug, featureDescription, commits)

  const r = spawnSync('gh', ['pr', 'create', '--title', title, '--body', body], {
    encoding: 'utf8', cwd: projectRoot, timeout: 30_000, env: { ...process.env },
  })

  const stderr = (r.stderr ?? '').trim()
  const stdout = (r.stdout ?? '').trim()
  if (r.status !== 0) throw new Error(`gh pr create failed:\n${stderr || stdout}`)

  const url = stdout.split('\n').filter(Boolean).pop() ?? ''
  console.log(`\n[pr-manager] PR created: ${url}\nTitle: ${title}`)
  return { url, title, alreadyExisted: false }
}
