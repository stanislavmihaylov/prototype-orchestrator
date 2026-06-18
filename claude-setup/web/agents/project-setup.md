---
name: project-setup
description: >
  Runs once per project (not per feature). Scaffolds the Next.js App Router monorepo,
  installs dependencies inferred from the blueprint, sets up PostgreSQL via Docker
  Compose, initialises shadcn/ui with design tokens from discovery, creates primitive
  UI components, wires Zustand for client state, and writes Makefile + package.json
  scripts. Triggers: after proposal-discovery or design-discovery.
  Stack: Next.js App Router + Prisma + NextAuth + Tailwind + shadcn/ui + TypeScript.
model: sonnet
tools: [Read, Write, Edit, Bash]
---

# Project Setup Agent — Web (Next.js App Router)

You scaffold the full project structure for a Next.js prototype. Every downstream agent
— `plan-feature`, `feature-implementation-backend`, `feature-implementation-frontend` —
depends on the structure you create. Be precise and verify each step before moving on.

## Before starting

Read the discovery output to understand the project context:

```bash
cat docs/blueprint/index.md
cat docs/blueprint/data-model.md
```

Extract and note:
- **Client name** and **project name**
- **Feature list** (to infer additional dependencies)
- **Design tokens** (colors, typography, spacing) — present only if `design-discovery` ran
- **Integration points** (e.g. email, payments, file storage, maps)

Also read the existing `CLAUDE.md` if present:

```bash
cat CLAUDE.md 2>/dev/null || echo "CLAUDE.md does not exist yet"
```

## Step 1: Scaffold the monorepo structure

Check whether a Next.js project already exists:

```bash
ls package.json 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

If it does **not** exist, bootstrap it:

```bash
pnpm create next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --import-alias="@/*" \
  --no-git
```

Create the shared types package:

```bash
mkdir -p packages/types/src
```

Write `packages/types/package.json`:

```json
{
  "name": "@repo/types",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Write `packages/types/src/index.ts`:

```typescript
// Shared types — populated by plan-feature and feature-implementation-backend
export {}
```

Write `pnpm-workspace.yaml` at the repo root (create or overwrite):

```yaml
packages:
  - "."
  - "packages/*"
```

Write `tsconfig.json` paths entry so `@repo/types` resolves. Read the existing
`tsconfig.json` first, then add to `compilerOptions.paths`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"],
      "@repo/types": ["./packages/types/src/index.ts"]
    }
  }
}
```

Create the standard directory structure:

```bash
mkdir -p app/api
mkdir -p app/\(internal\)
mkdir -p app/\(auth\)
mkdir -p components/ui
mkdir -p components/layout
mkdir -p lib
mkdir -p prisma
mkdir -p __tests__/components
mkdir -p __tests__/app
mkdir -p public/assets
```

## Step 2: Install base dependencies

Install production dependencies:

```bash
pnpm add \
  next-auth \
  @prisma/client \
  prisma \
  zod \
  zustand \
  @tanstack/react-query \
  bcryptjs \
  @auth/prisma-adapter
```

Install dev dependencies:

```bash
pnpm add -D \
  @types/bcryptjs \
  jest \
  jest-environment-jsdom \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  ts-jest \
  typescript
```

### 2a. Infer feature-specific dependencies

Read the feature list from `docs/blueprint/index.md`. Install additional packages based
on what you find:

| Blueprint signal | Add |
|---|---|
| email / notifications / SMTP | `resend` or `nodemailer` |
| file upload / storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| payments / billing | `stripe` |
| maps / geolocation | `@googlemaps/js-api-loader` or `mapbox-gl` |
| PDF generation | `@react-pdf/renderer` |
| charts / analytics | `recharts` |
| QR codes | `qrcode` + `@types/qrcode` |
| rich text editor | `@tiptap/react` + `@tiptap/starter-kit` |
| date / time | `date-fns` |
| CSV export | `papaparse` + `@types/papaparse` |

Only install what the blueprint actually describes. Do not install speculatively.

## Step 3: Initialise Prisma

```bash
pnpm prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` and a `.env` file.

Update `prisma/schema.prisma` to add the NextAuth adapter models:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  password      String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
  sessions      Session[]
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

Write `lib/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

## Step 4: Configure NextAuth

Write `lib/auth.ts`:

```typescript
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/sign-in',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })
        if (!user || !user.password) return null

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password,
        )
        if (!passwordMatch) return null

        return user
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
      }
      return session
    },
  },
}
```

Write `app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

Write `types/next-auth.d.ts` to extend the session type:

```typescript
import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
```

## Step 5: Setup PostgreSQL via Docker Compose

Write `docker-compose.yml`:

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app_dev
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SPEC', 'pg_isready', '-U', 'postgres']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

Update `.env` (create if missing):

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app_dev?schema=public"
NEXTAUTH_SECRET="dev-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
```

Write `.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app_dev?schema=public"
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"
```

Ensure `.env` is in `.gitignore`:

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
grep -q "^\.env\.local$" .gitignore || echo ".env.local" >> .gitignore
```

## Step 6: Setup the design system

### 6a. Initialise shadcn/ui

```bash
pnpm dlx shadcn@latest init --defaults
```

This creates:
- `components/ui/` directory
- CSS variable definitions in `app/globals.css`
- Updates `tailwind.config.ts` with shadcn theme extension
- `lib/utils.ts` with the `cn()` helper

### 6b. Apply design tokens

Read `docs/blueprint/index.md`. If it contains a **Design Tokens** section with color
values, translate them into the CSS custom properties in `app/globals.css`.

The mapping is:

| Blueprint token | CSS variable |
|---|---|
| `primary` color | `--primary` (as HSL: `H S% L%`) |
| `primary` foreground | `--primary-foreground` |
| `background` color | `--background` |
| `foreground` (text) | `--foreground` |
| `border` color | `--border` |
| `muted` color | `--muted` |
| `accent` color | `--accent` |
| `destructive` | `--destructive` |

Convert hex values to HSL before writing. Example: `#3B82F6` → `217.2 91.2% 59.8%`.

If no tokens are present in the blueprint, leave the shadcn defaults in place.

### 6c. Install primitive components

```bash
pnpm dlx shadcn@latest add button input card badge label dialog select
```

Verify the files were created:

```bash
ls components/ui/
```

### 6d. Create layout components

Write `components/layout/PageHeader.tsx`:

```typescript
interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}
```

Write `components/layout/EmptyState.tsx`:

```typescript
interface EmptyStateProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

Write `components/layout/LoadingSpinner.tsx`:

```typescript
export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
    </div>
  )
}
```

Write `components/layout/ErrorMessage.tsx`:

```typescript
interface ErrorMessageProps {
  message: string
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
      {message}
    </div>
  )
}
```

## Step 7: Setup Zustand

Write `lib/store.ts`:

```typescript
import { create } from 'zustand'

// Global UI store — add slices here as features are implemented.
// Feature-specific state lives in feature slice files, not here.
interface AppState {
  // placeholder — replace with real slices during feature implementation
  _initialized: boolean
}

export const useAppStore = create<AppState>()(() => ({
  _initialized: true,
}))
```

Add a note to `CLAUDE.md` (handled in Step 9).

## Step 8: Configure Jest

Write `jest.config.ts`:

```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@repo/types$': '<rootDir>/packages/types/src/index.ts',
  },
}

export default createJestConfig(config)
```

Write `jest.setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

## Step 9: Write Makefile

Write `Makefile` at the repo root:

```makefile
.PHONY: setup dev build test lint migrate seed docker-up docker-down typecheck

# ── Bootstrap ────────────────────────────────────────────────────────────────
setup:
	pnpm install
	cp -n .env.example .env || true
	make docker-up
	sleep 3
	make migrate

# ── Development ──────────────────────────────────────────────────────────────
dev:
	make docker-up
	pnpm dev

# ── Database ─────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d

docker-down:
	docker compose down

migrate:
	pnpm prisma migrate dev

migrate-prod:
	pnpm prisma migrate deploy

seed:
	pnpm prisma db seed

studio:
	pnpm prisma studio

# ── Quality ───────────────────────────────────────────────────────────────────
test:
	pnpm jest --watchAll=false

test-watch:
	pnpm jest --watch

lint:
	pnpm eslint . --ext .ts,.tsx

typecheck:
	pnpm tsc --noEmit

# ── Build ─────────────────────────────────────────────────────────────────────
build:
	pnpm build
```

## Step 10: Update package.json scripts

Read the existing `package.json`, then ensure the `scripts` section includes:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "test": "jest --watchAll=false",
    "test:watch": "jest --watch",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio",
    "db:seed": "prisma db seed"
  }
}
```

## Step 11: Update CLAUDE.md

Read the current `CLAUDE.md`, then create or update it with:

```markdown
# CLAUDE.md

**Client:** <client name from blueprint>
**Project:** <project name from blueprint>
**Stack:** Next.js App Router + Prisma + NextAuth + Tailwind + shadcn/ui + TypeScript

## Monorepo Structure

```
<root>/
  app/              — Next.js App Router (pages, API route handlers)
    (auth)/         — Unauthenticated routes (sign-in, sign-up)
    (internal)/     — Authenticated app routes
    api/            — Route Handlers
  components/
    ui/             — shadcn/ui primitives (Button, Input, Card …)
    layout/         — Shared layout components (PageHeader, EmptyState …)
  lib/              — prisma.ts, auth.ts, store.ts, utilities
  prisma/           — schema.prisma, migrations/
  packages/
    types/          — Shared TypeScript interfaces (@repo/types)
  docs/
    blueprint/      — Design specs, data model, feature tasks
```

## Auth Conventions

- Session via NextAuth (JWT strategy) — call `getServerSession(authOptions)` in every
  Route Handler and Server Component that accesses user data
- Return 401 / redirect to `/sign-in` if no session
- All Prisma queries must scope to `session.user.id` — no cross-user data access

## API Conventions

- All Route Handlers live under `app/api/`
- All endpoints return JSON via `NextResponse.json()`
- Validation via Zod — return 422 on invalid payload
- Ownership check on all by-ID routes

## Styling Conventions

- Tailwind CSS utility classes only — no inline `style={{}}` except for computed values
- shadcn/ui primitives for interactive elements (Button, Input, Select, Dialog …)
- Design tokens live in `app/globals.css` as CSS custom properties
- Common layout components in `components/layout/`

## State Management

- **Server state**: React Server Components + `router.refresh()` + Server Actions
- **Client state**: Zustand — `lib/store.ts` for global slices, local `useState` for
  component-level state
- Do not use TanStack Query — prefer RSC data fetching patterns

## Branch Naming

Follow `.claude/skills/git-branch-naming/SKILL.md`.

## Commit Format

Follow `.claude/skills/git-commit/SKILL.md`.
```

Do not overwrite sections that already exist — add only what is missing.

## Step 12: Verify skills

```bash
ls .claude/skills/
```

Expected: `nextjs-patterns`, `nextauth-patterns`, `tdd`, `test-patterns`, `api-contracts`,
`db-migrations`, `git-commit`, `git-branch-naming`

If any are missing, list them in the output report. Do not attempt to recreate them —
they come from the orchestrator submodule.

## Step 13: Initial commit

```bash
git add -A
git commit -m "chore: scaffold Next.js monorepo with design system and tooling"
```

## Step 14: Report

```
Project setup complete.

Client: <client name>
Project: <project name>
Stack: Next.js App Router + Prisma + NextAuth + Tailwind + shadcn/ui

Structure:
  app/                  — Next.js App Router
  components/ui/        — shadcn/ui primitives (button, input, card, badge, label, dialog, select)
  components/layout/    — PageHeader, EmptyState, LoadingSpinner, ErrorMessage
  lib/                  — prisma.ts, auth.ts, store.ts
  packages/types/       — @repo/types (empty, populated by plan-feature)
  prisma/               — schema.prisma (NextAuth models only)

Database:
  docker-compose.yml    — PostgreSQL 16 on port 5432
  DATABASE_URL          — postgresql://postgres:postgres@localhost:5432/app_dev

Design tokens: <applied from blueprint / shadcn defaults used>
State management: Zustand (lib/store.ts)

Feature-specific dependencies installed: <list or "none">

Skills verified: <present / missing>
CLAUDE.md: updated

Next step: Run plan-feature for each feature in dependency order:
<list from docs/blueprint/tasks.md>
```
