#!/usr/bin/env tsx
// CLI wrapper: notify.ts <title> <body> <level> [threadId]
// Called by the pipeline-orchestrator agent via Bash tool.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env before anything reads process.env (Node 20.12+ built-in)
const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  process.loadEnvFile(resolve(__dirname, '..', '.env'))
} catch { /* .env is optional — silently skip if missing */ }

import { send, Level } from './notifications.js'

const [, , title, body, level = 'info', threadId] = process.argv

if (!title || !body) {
  console.error('Usage: notify.ts <title> <body> <level> [threadId]')
  process.exit(1)
}

if (process.env.NOTIFICATIONS_DISABLED === 'true') {
  process.exit(0)
}

// await so the process stays alive until all channel fetches complete
;(async () => {
  try {
    await send(title, body, level as Level, threadId || undefined)
  } catch (err) {
    console.error('[notify] failed:', err)
    process.exit(1)
  }
})()
