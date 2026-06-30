---
name: git-branch-naming
description: >
  Git branch naming conventions for any monorepo in this pipeline.
  Pattern: <type>/<feature-slug>. Always branch from main. One feature per branch.
  Use when creating new branches for features, fixes, or maintenance.
---

# Git Branch Naming

## Pattern

```
<type>/<feature-slug>
```

- `type`: the change category (see table below)
- `feature-slug`: kebab-case, 2-5 words, describes what changed

## Branch types

| Type | Purpose | Example |
|---|---|---|
| `feat` | New feature | `feat/user-auth` |
| `fix` | Bug fix | `fix/login-token-expiry` |
| `chore` | Maintenance, deps, config | `chore/agent-improvements` |
| `refactor` | Code restructure, no behavior change | `refactor/auth-store` |
| `test` | Adding or updating tests only | `test/user-coverage` |
| `docs` | Documentation only | `docs/api-contracts` |

## Rules

1. **Always branch from `main`** — never from another feature branch
2. **One feature per branch** — do not bundle unrelated changes
3. **Kebab-case only** — no underscores, no PascalCase, no spaces
4. **2-5 words in the slug** — descriptive enough to understand without reading the code
5. **Never branch or push directly to `main`** — all changes go through PRs

## Examples

```bash
# Full-stack feature
git checkout -b feat/user-auth

# Backend-only
git checkout -b feat/journal-api

# Frontend / mobile screen
git checkout -b feat/mood-tracker-screen

# Bug fix
git checkout -b fix/login-token-expiry

# Pipeline/agent maintenance
git checkout -b chore/agent-improvements-2025-01-15

# Refactor
git checkout -b refactor/auth-store-cleanup
```

## Creating a branch correctly

```bash
# 1. Ensure you're on main and up to date
git checkout main
git pull origin main

# 2. Create the feature branch
git checkout -b feat/<feature-slug>

# 3. Verify
git branch --show-current
```

## What NOT to name branches

| Bad name | Problem | Correct |
|---|---|---|
| `feature/user-auth` | Use `feat`, not `feature` | `feat/user-auth` |
| `fix/UserAuth` | No PascalCase | `fix/user-auth` |
| `my-branch` | No type prefix | `feat/user-profile` |
| `feat/fix_bug` | No underscores | `feat/fix-bug` |
| `feat/add-new-user-authentication-system-with-oauth-and-profile` | Too long | `feat/user-auth` |
| `main` | Never commit directly to main | — |
