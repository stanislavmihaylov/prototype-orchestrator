# Claude Pipeline Orchestrator

Standalone Node.js SDLC orchestrator that drives a full feature pipeline by invoking Claude Code subagents programmatically. Ships with a live dashboard, checkpointed runs, human interrupt points, and notification channels.

Designed to be added to any project as a **git submodule**.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Adding to a New Project](#adding-to-a-new-project)
- [Main Project Configuration](#main-project-configuration)
- [First-Time Setup](#first-time-setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Pipeline Flow](#pipeline-flow)
- [On-Demand Agents](#on-demand-agents)
- [Updating the Submodule](#updating-the-submodule)
- [Making Changes to the Orchestrator](#making-changes-to-the-orchestrator)
- [Notifications](#notifications) TODO
- [Model Assignments](#model-assignments)

---

## Prerequisites

- Node.js ≥ 20
- npm
- Docker (for the dashboard container and the project's database)
- Claude Code CLI (`claude`) installed and authenticated
- GitHub CLI (`gh`) installed and authenticated

---

## Adding to a New Project

```bash
# From your project root
git submodule add https://github.com/stanislavmihaylov/prototype-orchestrator
git submodule update --init
```

---

## Main Project Configuration

### 1. Makefile

Add these targets and extend your existing `setup` target:

```makefile
# ─── Pipeline ─────────────────────────────────────────────────────────────────
orchestrator-setup:
	git submodule update --init
      # unix
	sh prototype-orchestrator/setup.sh 
      # windows
      .\prototype-orchestrator\setup.ps1

pipeline-install:
	cd prototype-orchestrator && npm install

pipeline-start:
	@test -n "$(FEATURE)" || (echo "Usage: make pipeline-start FEATURE=\"<flow name>\" [SCOPE=backend|mobile|both]"; exit 1)
	cd prototype-orchestrator && npm run pipeline -- start "$(FEATURE)" $(if $(SCOPE),--scope $(SCOPE),)

pipeline-resume:
	@test -n "$(THREAD)" || (echo "Usage: make pipeline-resume THREAD=<threadId>"; exit 1)
	cd prototype-orchestrator && npm run pipeline -- resume "$(THREAD)"

pipeline-dashboard:
	docker compose -f prototype-orchestrator/docker-compose.yml up --build
```


### 2. Runtime data directory

The orchestrator writes all runtime data to `orchestrator_logs/` at the project root. Commit this directory — it gives the whole team full traceability of every pipeline run.

```bash
mkdir -p orchestrator_logs/runs orchestrator_logs/interactions orchestrator_logs/responses orchestrator_logs/logs/feedback
```

Do **not** add `orchestrator_logs/` to `.gitignore`.

### 3. `.gitignore`

Add the submodule directory so git treats it as a pointer rather than a regular folder:

```gitignore
/prototype-orchestrator/
```

---

## First-Time Setup

After adding the submodule, or after a fresh `git clone --recurse-submodules`:

```bash
# Unix / macOS / Git Bash
make orchestrator-setup

# Windows (PowerShell)
git submodule update --init
.\orchestrator\setup.ps1
```

Then create your local config:

```bash
cp prototype-orchestrator/.env.example prototype-orchestrator/.env
# Edit prototype-orchestrator/.env with project-specific values
```

What `setup.sh` / `setup.ps1` does:
1. Creates a symlink (Unix) or junction (Windows) from `.claude/` in your project root → `prototype-orchestrator/.claude/`
2. Runs `npm install` inside the prototype-orchestrator directory

After setup your project root will look like this:

```
project-root/
  .claude/                ← symlink → prototype-orchestrator/.claude/
  prototype-orchestrator/           ← submodule
  orchestrator_logs/
    runs/
    interactions/
    responses/
    logs/
      feedback/
```

### Cloning a project that already uses this submodule

```bash
git clone --recurse-submodules <repo-url>
make orchestrator-setup
cp prototype-orchestrator/.env.example prototype-orchestrator/.env
```

---

## Configuration

| Variable | Description | Default |
|---|---|---|
| `PIPELINE_DATA_DIR` | Where runtime data is stored, relative to `prototype-orchestrator/` | `../orchestrator_logs` |
| `HAS_DESIGN` | `true` if project has a Figma file; `false` for proposal-based projects | `true` |
| `SKIP_ENV_CHECK` | Skip the environment validation step | `false` |
| `FIGMA_FILE_KEY` | Required when `HAS_DESIGN=true` | — |
| `PIPELINE_DASHBOARD_PORT` | Dashboard port | `4242` |
| `NOTIFICATIONS_DISABLED` | Suppress all notifications | `false` |

`prototype-orchestrator/.env` is gitignored — each project keeps its own copy.

To override which Claude model each agent uses, edit `prototype-orchestrator/pipeline.config.json`:

```json
{
  "agents": {
    "plan-feature": "claude-opus-4-8",
    "reviewer": "claude-opus-4-8"
  }
}
```

---

## Usage

```bash
# Start the live dashboard (http://localhost:4242)
make pipeline-dashboard

# Start a pipeline run
make pipeline-start FEATURE="Claims Submission"
make pipeline-start FEATURE="Claims Submission" SCOPE=backend

# Resume after an interrupt or crash
make pipeline-resume THREAD=2026-06-10T09-52-07
```

The thread ID is printed to the terminal on start and is visible in the dashboard.

---

## Pipeline Flow

```
environment-checker           Verify Docker, Postgres, Node ≥ 20, npm, env vars, git clean
      ↓
design-analyst-flow           Figma → docs/blueprint/flows/<slug>.md
  (skipped when HAS_DESIGN=false)
      ↓
plan-feature                  Full-stack plan + shared types contract

━━━ INTERRUPT #1 — review plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply "approved" to continue, or describe what needs to change.

      ↓
feature-implementation-backend    Route Handlers → Prisma → types sync (TDD)
      ↓
feature-implementation-frontend   Pages + components (TDD)
      ↓
test-runner                   Jest → TypeScript → lint → build
      ↓
reviewer                      Code quality + OWASP security review
      ↓
auto-fix loop                 One automatic re-implementation pass on critical/high findings

━━━ INTERRUPT #2 — approve merge ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply "merge", "hold", or "fix: <feedback>".

      ↓
pr-manager                    git push → gh pr create → marks tasks.md [x]
```

---

## On-Demand Agents

Invoked manually via the Claude Code CLI, outside the pipeline:

| Agent | Purpose |
|---|---|
| `design-discovery` | Figma → `docs/blueprint/index.md` + `data-model.md`; run once at project start |
| `proposal-discovery` | Proposal doc → full `docs/blueprint/` foundation; use instead of design-discovery for non-Figma projects |
| `doc-writer` | Updates `docs/api.md`, `docs/features/<slug>.md`, `docs/architecture.md` |
| `process-improver` | Reads feedback logs, patches agents/skills/CLAUDE.md; run after every 3–5 features |
| `test-backend` | Runs backend suite in isolation without writing feature code |
| `test-frontend` | Runs frontend suite in isolation |
| `test-e2e` | Runs Maestro E2E flows |
| `test-case-generator` | Generates Jest stub files before implementation begins |
| `types-sync` | Manually syncs backend response types → `packages/types/` |

---

## Updating the Submodule

```bash
# Pull latest from the orchestrator repo
git submodule update --remote orchestrator

# Review what changed
git diff orchestrator

# Commit the updated pin
git add orchestrator
git commit -m "chore: update orchestrator submodule"
git push
```

After updating, check `prototype-orchestrator/.env.example` for any new variables to add to your local `.env`.

---

## Making Changes to the Orchestrator

Changes to agents, skills, pipeline logic, or the dashboard belong in the orchestrator repo — not in the consuming project.

```bash
# Work inside the submodule
cd orchestrator
git checkout -b fix/my-change

# Make changes, commit, push
git add .
git commit -m "fix: description"
git push origin fix/my-change

# Open a PR in the orchestrator repo and merge it
# Then back in the consuming project, update the pin:
cd ..
git submodule update --remote orchestrator
git add orchestrator
git commit -m "chore: update orchestrator submodule"
git push
```

Never commit prototype-orchestrator source changes from the consuming project root — they update only the submodule pointer, not the prototype-orchestrator repo itself.

---

## Notifications (TODO)

All channels are optional — any channel without config is silently skipped.

| Channel | Env vars |
|---|---|
| Slack | `SLACK_WEBHOOK_URL` |
| Microsoft Teams | `TEAMS_WEBHOOK_URL` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` |

For Office 365: `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`.

---

## Model Assignments

| Agent | Default model |
|---|---|
| `design-analyst-flow` | Sonnet |
| `plan-feature` | Sonnet |
| `feature-implementation-backend` | Sonnet |
| `feature-implementation-frontend` | Sonnet |
| `test-runner` | Sonnet |
| `reviewer` | Opus |
| `environment-checker` | Haiku |
| `pr-manager` | Haiku |
| All on-demand agents | Sonnet |

Override any assignment in `prototype-orchestrator/pipeline.config.json`.
