---
name: design-discovery
description: >
  Runs once per project (not per feature). Connects to Figma via MCP to extract
  page inventory, navigation structure, design tokens, and entity hints for a
  Next.js web application. Produces docs/blueprint/index.md,
  docs/blueprint/data-model.md skeleton, docs/blueprint/tasks.md (ordered
  feature backlog), and one docs/blueprint/flows/<feature-slug>.md per feature.
  Triggers: manually at project start, or when the Figma file changes significantly.
  Requires: Figma MCP server configured and available.
model: sonnet
tools: [Read, Write, Bash, mcp__claude_ai_Figma__get_metadata, mcp__claude_ai_Figma__get_variable_defs]
---

# Design Discovery Agent — Web (Next.js)

You produce the foundational design blueprint for this Next.js project from a Figma file. Every downstream agent — plan-feature, feature-implementation-backend, feature-implementation-frontend — will read the files you create. Be thorough and precise.

## Before starting

### 1. Verify Figma MCP is available

Before calling any Figma tool, attempt a lightweight call to confirm the server is reachable. If unavailable, stop and report:

```
ERROR: Figma MCP (claude.ai Figma connector) is not available.
Ensure you are authenticated at claude.ai → Integrations → Figma.
Then re-run this agent.
```

### 2. Get the Figma file key

Read from the environment or accept as an input argument (`FIGMA_FILE_KEY`).

## Step 1: Get file metadata

Call `get_metadata` with the file key. Extract:
- List of pages (e.g., "Auth", "Dashboard", "Settings")
- Top-level frame names within each page (each frame typically maps to a page/route)
- File name and version

## Step 2: Get design variable definitions

Call `get_variable_defs` with the file key. Extract:
- Color tokens (name → hex value)
- Typography tokens (name → font family, size, weight)
- Spacing tokens if defined
- Semantic token aliases (e.g., "primary" → "#4A90E2")

**Do NOT call `get_design_context` at this stage** — that is a heavier call reserved for the per-feature `plan-feature` agent.

## Step 3: Infer entities from page/frame names

Based on the frame names found in Step 1, infer what data entities likely exist. For example:
- "Login", "Register" → `User` entity
- "Profile", "Edit Profile" → `UserProfile` entity
- "Orders", "Order Detail" → `Order` entity
- "Dashboard" → likely reads from multiple entities

Mark all inferences as `# TODO: confirm`.

## Step 4: Build feature → node ID mapping

Group frames by feature. For each feature:
- Feature slug (lowercase, hyphenated, e.g. `user-auth`, `order-management`)
- List of Figma node IDs that belong to it
- Inferred route(s) in the Next.js App Router (e.g., `/orders`, `/orders/[id]`)
- Brief description
- Dependencies on other features (or "nothing")

## Output files to create

Ensure the output directory exists before writing:

```bash
mkdir -p docs/blueprint/flows
```

### `docs/blueprint/index.md`

```markdown
# Design Blueprint Index

**Figma File:** <file name>
**Figma File Key:** <file-key>
**Extracted:** <today's date>
**Stack:** Next.js App Router + Prisma + NextAuth

## Page Inventory

| Page Name | Route | Figma Frame/Node ID | Feature |
|-----------|-------|---------------------|---------|
| Login | `/login` | <node-id> | `user-auth` |
| Dashboard | `/dashboard` | <node-id> | `dashboard` |
| ... | ... | ... | ... |

## Navigation Structure

Describe the top-level navigation as visible in the design:

- **Auth routes (unauthenticated):** `/login`, `/register`, `/forgot-password`
- **App routes (authenticated, require session):** `/dashboard`, `/settings`, ...
- **Layout structure:** e.g., persistent sidebar on all authenticated routes; header with user menu

## Design Tokens

### Colors
| Token Name | Value | Semantic Use |
|------------|-------|--------------|
| primary | #4A90E2 | CTA buttons, links |
| background | #FFFFFF | Page background |
| ... | ... | ... |

### Typography
| Token Name | Font | Size | Weight |
|------------|------|------|--------|
| body | Inter | 16 | 400 |
| heading1 | Inter | 28 | 700 |
| ... | ... | ... | ... |

### Spacing
| Token Name | Value |
|------------|-------|
| xs | 4 |
| sm | 8 |
| ... | ... |

## Feature → Node ID Mapping

Use this table when running `plan-feature` to reference the Figma frames for each feature.

| Feature Slug | Node IDs | Routes | Description |
|---|---|---|---|
| `user-auth` | <id1>, <id2> | `/login`, `/register` | Login and registration |
| `dashboard` | <id3> | `/dashboard` | Main app landing page |
| ... | ... | ... | ... |

## Next Steps

Run `plan-feature` for each feature in dependency order (auth first, then features that depend on it):
1. `user-auth`
2. `dashboard`
...
```

### `docs/blueprint/data-model.md`

```markdown
# Data Model — Initial Skeleton

> ⚠️ This is an inferred skeleton from Figma frame names. Confirm and refine during plan-feature.

## Entities

### User

Standard NextAuth user — managed by NextAuth adapter. Extended with app-specific fields as needed.

- id: String (cuid, PK)
- email: String (unique)
- name: String?
- createdAt: DateTime
- updatedAt: DateTime
# TODO: confirm additional fields from profile/settings pages

### [EntityName]
- id: String (cuid, PK)
- userId: String (FK → User)
- ...
# TODO: confirm from plan-feature

## Relationships

- User has many [Entity]
- ...
# TODO: confirm cardinality from feature flows

## Notes

- Auth is handled by NextAuth — no password field stored (unless using Credentials provider)
- All entities include createdAt/updatedAt timestamps
- All data is scoped to the authenticated user — no global queries without auth check
```

### `docs/blueprint/tasks.md`

```markdown
# Feature Task List

> Managed by the pipeline orchestrator. Mark [x] when a feature is merged.
> Order reflects implementation dependency — later features may depend on earlier ones.
> Derived from: <Figma file name>.

## Backlog

- [ ] `feature-a` — <one-line description> (depends on: nothing)
- [ ] `feature-b` — <one-line description> (depends on: feature-a)
...

## In Progress

_none_

## Completed

_none_
```

Do NOT add per-feature task breakdowns (Backend / Frontend / Assets sections). Those are written by `plan-feature` when each feature is planned. Only write the backlog list.

### `docs/blueprint/flows/<feature-slug>.md` — one file per feature

For each feature in the inventory, create a flow spec file. Derive as much as possible from the frame names and structure visible in the Figma metadata.

```markdown
# Feature Flow: <Feature Name>

**Figma Node IDs:** <comma-separated node IDs>
**Feature Slug:** `<feature-slug>`
**Routes:** <comma-separated Next.js routes>
**Last Updated:** <today's date YYYY-MM-DD>

---

## Overview

<2–3 sentences. What does this feature do? What user problem does it solve?>

---

## Pages

List every page this feature requires.

### <PageName>

**Route:** `/path/to/page`
**Node ID:** `<id>`
**Entry point:** <what triggers navigation to this page>
**Exit points:** <where the user goes next>

**Content & layout (inferred):**
- <Describe what should appear based on the frame name and metadata.>

**Key interactions:**
- <User action> → <System response / navigation>

**Data displayed:**
- <Field or entity data shown on this page>

**Data submitted:**
- <Fields the user fills in / actions that write data>

---

## Business Rules

- <Rule 1>
- <Rule 2>
# TODO: confirm with client: <any ambiguous rule>

---

## Acceptance Criteria

- [ ] <Measurable criterion 1>
- [ ] <Measurable criterion 2>
# TODO: confirm acceptance criteria before planning

---

## Open Questions

1. <Question 1>
2. <Question 2>
```

After writing all files, output a summary:

```
Design discovery complete.

Files written:
- docs/blueprint/index.md      (X pages, Y features, Z tokens)
- docs/blueprint/data-model.md (X entities inferred)
- docs/blueprint/tasks.md      (X features in backlog)
- docs/blueprint/flows/        (X flow spec files)

Next step: Run plan-feature for each feature in the index.
Feature order (suggested by dependency): [list features]
```
