/**
 * Notification channels — all optional, enabled by env vars.
 *
 * SLACK_WEBHOOK_URL    Slack Incoming Webhook URL
 * TEAMS_WEBHOOK_URL    Teams Incoming Webhook URL (channel connector)
 * SMTP_HOST            e.g. smtp.office365.com
 * SMTP_PORT            default 587
 * SMTP_USER            sender address / login
 * SMTP_PASSWORD        app password
 * NOTIFY_EMAIL_TO      recipient(s), comma-separated
 * NOTIFY_EMAIL_FROM    sender display address (defaults to SMTP_USER)
 */

import nodemailer from 'nodemailer'

export type Level = 'info' | 'warning' | 'error'

const COLORS: Record<Level, string> = {
  info: '#36a64f',
  warning: '#FFA500',
  error: '#FF0000',
}

const THEME_COLORS: Record<Level, string> = {
  info: '0076D7',
  warning: 'FFA500',
  error: 'FF0000',
}

export async function send(
  title: string,
  body: string,
  level: Level = 'info',
  threadId?: string,
): Promise<void> {
  printConsole(title, body, level, threadId)
  await Promise.allSettled([
    sendSlack(title, body, level, threadId),
    sendTeams(title, body, level, threadId),
    sendEmail(title, body, level, threadId),
  ])
}

// ── Console ───────────────────────────────────────────────────────────────────

function printConsole(title: string, body: string, level: Level, threadId?: string): void {
  const divider = '─'.repeat(60)
  const resumeHint = threadId
    ? `\nResume: open Claude Code and type: Resume pipeline ${threadId}`
    : ''
  console.log(`\n${divider}\nNOTIFICATION [${level.toUpperCase()}]: ${title}\n${divider}\n${body}${resumeHint}\n${divider}`)
}

// ── Slack ─────────────────────────────────────────────────────────────────────

async function sendSlack(title: string, body: string, level: Level, threadId?: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return

  const footerParts = [`Recovery Companion • ${new Date().toISOString().slice(0, 16)}`]
  if (threadId) footerParts.push(`Thread: ${threadId}`)

  await postJson(url, {
    text: `*${title}*`,
    attachments: [{
      color: COLORS[level],
      text: appendResumeHint(body, threadId).slice(0, 2000),
      footer: footerParts.join(' | '),
    }],
  }, 'Slack')
}

// ── Microsoft Teams ───────────────────────────────────────────────────────────

async function sendTeams(title: string, body: string, level: Level, threadId?: string): Promise<void> {
  const url = process.env.TEAMS_WEBHOOK_URL
  if (!url) return

  // Power Automate / Power Platform webhooks (powerplatform.com, logic.azure.com)
  // expect Adaptive Card format. Legacy Office 365 connector webhooks
  // (outlook.office.com/webhook) expect the older MessageCard format.
  const isWorkflowWebhook =
    url.includes('powerplatform.com') ||
    url.includes('logic.azure.com')

  if (isWorkflowWebhook) {
    await sendTeamsAdaptiveCard(url, title, body, level, threadId)
  } else {
    await sendTeamsMessageCard(url, title, body, level, threadId)
  }
}

async function sendTeamsAdaptiveCard(
  url: string,
  title: string,
  body: string,
  level: Level,
  threadId?: string,
): Promise<void> {
  // Adaptive Card color labels for Teams
  const acColor: Record<Level, string> = { info: 'Good', warning: 'Warning', error: 'Attention' }

  const cardBody: unknown[] = [
    {
      type: 'TextBlock',
      size: 'Large',
      weight: 'Bolder',
      color: acColor[level],
      text: title,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      isSubtle: true,
      size: 'Small',
    },
    {
      type: 'TextBlock',
      text: body.slice(0, 3000),
      wrap: true,
    },
  ]

  if (threadId) {
    cardBody.push({
      type: 'FactSet',
      facts: [
        { title: 'Thread ID', value: threadId },
        { title: 'Resume command', value: `Resume pipeline ${threadId}` },
      ],
    })
  }

  await postJson(url, {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.5',
        body: cardBody,
      },
    }],
  }, 'Teams')
}

async function sendTeamsMessageCard(
  url: string,
  title: string,
  body: string,
  level: Level,
  threadId?: string,
): Promise<void> {
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Severity', value: level.toUpperCase() },
  ]
  if (threadId) {
    facts.push({ title: 'Thread ID', value: threadId })
    facts.push({ title: 'Resume in Claude Code', value: `Resume pipeline ${threadId}` })
  }

  await postJson(url, {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: THEME_COLORS[level],
    summary: title,
    sections: [{
      activityTitle: `**${title}**`,
      activitySubtitle: new Date().toISOString().slice(0, 16),
      text: body.slice(0, 3000),
      facts,
    }],
  }, 'Teams')
}

// ── Email (SMTP) ──────────────────────────────────────────────────────────────

async function sendEmail(title: string, body: string, level: Level, threadId?: string): Promise<void> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const toRaw = process.env.NOTIFY_EMAIL_TO

  if (!host || !user || !pass || !toRaw) return

  const to = toRaw.split(',').map(a => a.trim()).filter(Boolean)
  const from = process.env.NOTIFY_EMAIL_FROM ?? user
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)

  const transport = nodemailer.createTransport({ host, port, secure: false, auth: { user, pass } })

  await transport.sendMail({
    from,
    to,
    subject: `[${level.toUpperCase()}] Pipeline: ${title}`,
    text: appendResumeHint(body, threadId),
    html: buildEmailHtml(title, body, level, threadId),
  })

  console.log(`[notify] email sent to ${to.join(', ')}`)
}

function buildEmailHtml(title: string, body: string, level: Level, threadId?: string): string {
  const color = COLORS[level]
  const resumeRow = threadId ? `
    <tr>
      <td style="padding:12px 16px;background:#f5f5f5;">
        <strong>Resume in Claude Code</strong><br>
        Open Claude Code and type:<br>
        <code style="font-size:13px;">Resume pipeline ${threadId}</code>
      </td>
    </tr>` : ''

  return `
  <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
    <div style="background:${color};padding:4px 16px;border-radius:4px 4px 0 0;">
      <h2 style="color:#fff;margin:8px 0;">${title}</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;border-top:none;">
      <tr><td style="padding:16px;">${body.replace(/\n/g, '<br>')}</td></tr>
      ${resumeRow}
      <tr>
        <td style="padding:8px 16px;background:#fafafa;font-size:12px;color:#888;">
          Recovery Companion Orchestrator &bull; ${new Date().toISOString().slice(0, 16)}
          ${threadId ? `&bull; Thread: ${threadId}` : ''}
        </td>
      </tr>
    </table>
  </body></html>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function appendResumeHint(body: string, threadId?: string): string {
  if (!threadId) return body
  return (
    `${body}\n\n${'─'.repeat(30)}\n` +
    `Thread ID: ${threadId}\n\n` +
    `Open Claude Code and type:\n` +
    `  Resume pipeline ${threadId}`
  )
}

async function postJson(url: string, payload: unknown, channel: string): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)')
      console.warn(`[notify] ${channel} responded ${res.status}: ${body.slice(0, 400)}`)
    } else {
      console.log(`[notify] ${channel} sent`)
    }
  } catch (err) {
    console.warn(`[notify] ${channel} failed: ${err}`)
  }
}
