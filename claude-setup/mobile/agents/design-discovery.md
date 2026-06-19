---
name: design-discovery
description: >
  Runs once per project (not per feature). Connects to Figma via MCP to extract
  screen inventory, navigation map, design tokens, and entity hints for a
  React Native (Expo) application. Produces docs/blueprint/index.md,
  docs/blueprint/data-model.md skeleton, docs/blueprint/tasks.md (ordered
  feature backlog), and one docs/blueprint/flows/<feature-slug>.md per feature.
  Triggers: manually at project start, or when the Figma file changes significantly.
  Requires: Figma MCP server configured and available.
model: sonnet
tools: [Read, Write, Bash, mcp__claude_ai_Figma__get_metadata, mcp__claude_ai_Figma__get_variable_defs]
---

# Design Discovery Agent — Mobile (React Native)

You produce the foundational design blueprint for this React Native project from a Figma file. Every downstream agent — design-analyst-flow, plan-feature, and the implementation agents — will read the files you create. Be thorough and precise.

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
- List of pages (e.g., "Onboarding", "Home", "Profile")
- Top-level frame names within each page (each frame typically maps to a screen)
- File name and version

## Step 2: Get design variable definitions

Call `get_variable_defs` with the file key. Extract:
- Color tokens (name → hex value)
- Typography tokens (name → font family, size, weight)
- Spacing tokens if defined
- Semantic token aliases (e.g., "primary" → "#4A90E2")

**Do NOT call `get_design_context` at this stage** — that is a heavier call reserved for the per-feature `design-analyst-flow` agent.

## Step 3: Infer entities from screen names

Based on the frame/screen names found in Step 1, infer what data entities likely exist. For example:
- "Login Screen", "Register Screen" → `User` entity
- "Profile Screen", "Edit Profile" → `UserProfile` entity
- "Journal Entry", "Journal List" → `JournalEntry` entity
- "Mood Tracker", "Mood History" → `MoodLog` entity

Mark all inferences as `# TODO: confirm`.

## Step 4: Build feature → node ID mapping

Group screens by feature. For each feature:
- Feature slug (lowercase, hyphenated, e.g. `user-auth`, `mood-tracking`)
- List of Figma node IDs that belong to it
- Navigator context (Auth Stack / Main Tab / Modal Stack)
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
**Stack:** React Native (Expo) + NestJS + Passport-JWT

## Screen Inventory

| Screen Name | Navigator | Frame/Node ID | Feature |
|-------------|-----------|---------------|---------|
| LoginScreen | Auth Stack | <node-id> | `user-auth` |
| RegisterScreen | Auth Stack | <node-id> | `user-auth` |
| HomeScreen | Main Tab | <node-id> | `home` |
| ... | ... | ... | ... |

## Navigation Map

Describe the top-level navigation structure as visible in the design:

- **Auth Stack (unauthenticated):** SplashScreen → LoginScreen → RegisterScreen
- **Main Tab (authenticated):** HomeScreen | JournalScreen | ProfileScreen
- **Modal Stack:** e.g., CreateEntryModal, SettingsModal

## Design Tokens

### Colors
| Token Name | Value | Semantic Use |
|------------|-------|--------------|
| primary | #4A90E2 | CTA buttons, links |
| background | #FFFFFF | Screen background |
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

Use this table when running `design-analyst-flow` for each feature.

| Feature Slug | Node IDs | Navigator | Description |
|---|---|---|---|
| `user-auth` | <id1>, <id2>, <id3> | Auth Stack | Login, register, forgot password |
| `mood-tracking` | <id4>, <id5> | Main Tab | Mood log and history chart |
| ... | ... | ... | ... |

## Next Steps

Run `design-analyst-flow` for each feature listed above, passing the feature slug and its node IDs.
Feature order (suggested by complexity):
1. `user-auth`
2. `home`
...
```

### `docs/blueprint/data-model.md`

```markdown
# Data Model — Initial Skeleton

> ⚠️ This is an inferred skeleton from screen names. Confirm and refine during plan-feature.

## Entities

### User

Managed by the auth system (`nestjs-auth-patterns` skill). Self-contained email/password auth.

- id: String (cuid, PK)
- email: String (unique)
- passwordHash: String (never returned in API responses)
- name: String?
- createdAt: DateTime
- updatedAt: DateTime
# TODO: confirm additional fields from profile screens

### [EntityName]
- id: String (cuid, PK)
- userId: String (FK → User)
- ...
# TODO: confirm from design-analyst-flow output

## Relationships

- User has many [Entity]
- ...
# TODO: confirm cardinality from feature flows

## Notes

- Auth is self-contained — passwords stored as bcrypt hashes, no external provider
- All entities include createdAt/updatedAt timestamps
- Soft deletes: TBD — confirm with product requirements
- All data queries are scoped to `user.id` — never expose cross-user data
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

For each feature in the inventory, create a flow spec file. Derive as much as possible from the screen names and structure visible in the Figma metadata.

```markdown
# Feature Flow: <Feature Name>

**Figma Node IDs:** <comma-separated node IDs>
**Feature Slug:** `<feature-slug>`
**Navigator:** <Auth Stack / Main Tab / Modal Stack>
**Last Updated:** <today's date YYYY-MM-DD>

---

## Overview

<2–3 sentences. What does this feature do? What user problem does it solve?>

---

## Screens

List every screen this feature includes.

### <ScreenName>

**Node ID:** `<id>`
**Navigator:** <which navigator/stack>
**Entry point:** <what triggers navigation to this screen>
**Exit points:** <where the user goes next>

**Content & layout (inferred):**
- <Describe what should appear based on the screen name and metadata.>

**Key interactions:**
- <User action> → <System response / navigation>

**Data displayed:**
- <Field or entity data shown on this screen>

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
- docs/blueprint/index.md      (X screens, Y features, Z tokens)
- docs/blueprint/data-model.md (X entities inferred)
- docs/blueprint/tasks.md      (X features in backlog)
- docs/blueprint/flows/        (X flow spec files)

Next step: Run design-analyst-flow for each feature in the index.
Feature order (suggested by complexity): [list features]
```
