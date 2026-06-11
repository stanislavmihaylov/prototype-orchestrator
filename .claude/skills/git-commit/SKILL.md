---
name: git-commit
description: >
  Conventional Commits for this NestJS + React Native monorepo.
  Format: <type>(<scope>): <description>. Covers scopes, examples,
  atomic commit rules, and what never to commit.
---

# Git Commit Skill — NestJS + React Native Monorepo

## Format

```
<type>(<scope>): <description>
```

All three parts are required. Keep the full message under 72 characters.

## Types

| Type | When to use |
|---|---|
| `feat` | New feature added |
| `fix` | Bug fixed |
| `chore` | Maintenance, deps, config, tooling |
| `refactor` | Code restructured without behavior change |
| `test` | Tests added or updated (no production code change) |
| `docs` | Documentation only |
| `ci` | CI/CD pipeline changes |

## Scopes for this monorepo

| Scope | What it covers |
|---|---|
| `backend` | Changes in `apps/backend/` |
| `mobile` | Changes in `apps/mobile/` |
| `types` | Changes in `packages/types/` |
| `orchestrator` | Changes in `prototype-orchestrator/` |
| `agents` | Changes in `.claude/agents/` |
| `deps` | Dependency updates (`package.json`, `pnpm-lock.yaml`) |

## Examples

```
feat(backend): add journal entry CRUD endpoints
feat(mobile): implement journal list screen
feat(types): add JournalEntry request and response types
fix(backend): return 404 instead of 500 when entry not found
fix(mobile): attach Bearer token to mood tracking store actions
chore(deps): upgrade NestJS to v11
refactor(mobile): extract auth token helper into shared hook
test(backend): add service-level tests for MoodLog ownership checks
docs(agents): update plan-feature with API contract section
chore(agents): apply process improvements from feedback analysis
```

## Rules

### Keep commits atomic

One logical change per commit. Do not bundle:
- Backend + mobile changes in one commit (commit separately)
- Feature code + unrelated refactors
- Multiple features

### Good commit messages

- Use present tense, imperative mood: "add endpoint" not "added endpoint"
- Describe the behavior change, not the implementation: "return 404 for missing entries" not "change findById conditional"
- Keep description under 50 characters if possible

### Commit body (use when needed)

For non-obvious changes, add a body after a blank line:

```
fix(backend): scope mood logs to authenticated user

Previously findAll() returned all records regardless of userId.
Now filters by req.user.sub to prevent data leakage.

Closes #47
```

## Never commit these files

| File | Why |
|---|---|
| `.env`, `.env.local`, `.env.*` | Contains secrets |
| `node_modules/` | Managed by pnpm |
| `dist/`, `build/` | Generated artifacts |
| `apps/backend/generated/` | Prisma generated client |
| `*.log` | Runtime logs |
| `.DS_Store` | macOS metadata |

Before committing, verify: `git status` and `git diff --staged` to see exactly what you are including.

## Workflow

```bash
# 1. Check what changed
git status
git diff --staged

# 2. Stage specific files (prefer specificity over git add .)
git add apps/backend/src/journal/
git add apps/backend/src/journal/__tests__/

# 3. Commit with message
git commit -m "feat(backend): add journal entry creation endpoint"

# 4. Verify
git log --oneline -3
```
