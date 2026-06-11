---
name: db-migrations
description: >
  Prisma migration workflow for a Next.js full-stack project (Docker
  PostgreSQL). Covers safe migration patterns, dangerous patterns to avoid,
  team coordination, and seeding. Use when adding/modifying database models or
  running migrations.
---

# Database Migrations — Prisma + PostgreSQL (Docker)

## Schema location

```
prisma/
  schema.prisma     ← single schema file at the project root (not inside apps/)
  migrations/       ← committed migration history
  seed.ts           ← idempotent seed script
```

## Standard migration workflow

Every schema change follows this exact sequence:

```bash
# 1. Edit the Prisma schema
# File: prisma/schema.prisma

# 2. Create and apply the migration (dev database)
npx prisma migrate dev --name <descriptive-name>

# 3. Regenerate the Prisma client (so TypeScript types update)
npx prisma generate

# 4. Verify the migration applied cleanly
npx prisma migrate status
```

Or via pnpm scripts if defined in package.json:

```bash
pnpm db:migrate --name <descriptive-name>
pnpm db:generate
pnpm db:status
```

Migration names: use kebab-case, describe what changed, be specific.

```bash
# Good names
npx prisma migrate dev --name add-claim-table
npx prisma migrate dev --name add-claim-notes-column
npx prisma migrate dev --name make-provider-npi-nullable

# Bad names
npx prisma migrate dev --name update
npx prisma migrate dev --name fix
npx prisma migrate dev --name migration1
```

## Prisma singleton — use this pattern in Next.js

```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

Import from `@/lib/prisma` in Route Handlers and Server Components. Never create
`new PrismaClient()` anywhere else.

## Safe migration patterns

### Adding a new table

Always safe — new table does not affect existing data.

```prisma
model Claim {
  id              String   @id @default(cuid())
  claimNumber     String   @unique
  status          String   @default("SUBMITTED")
  submittedById   String
  submittedBy     User     @relation(fields: [submittedById], references: [id], onDelete: Cascade)
  submittedAmount Decimal
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("claims")
}
```

### Adding a nullable column to an existing table

Safe — existing rows get `null` for the new column.

```prisma
model Claim {
  // existing fields
  notes     String?   // nullable — safe to add
}
```

### Adding a non-nullable column with a default

Safe — existing rows get the default value.

```prisma
model Claim {
  // existing fields
  priority  String  @default("NORMAL")  // has default — safe
}
```

### Adding an index

Safe — does not change data.

```prisma
model Claim {
  // ...
  @@index([submittedById, createdAt])
}
```

## Dangerous migration patterns

### Making an existing nullable column non-nullable

**DANGEROUS** — existing rows with `null` will fail the constraint.

Safe approach — two migrations:

```bash
# Migration 1: backfill nulls with a sensible default
npx prisma migrate dev --name backfill-claim-priority-defaults
# (write a custom SQL migration to UPDATE claims SET priority = 'NORMAL' WHERE priority IS NULL)

# Migration 2: add the NOT NULL constraint
npx prisma migrate dev --name make-claim-priority-required
```

### Renaming a column

**DANGEROUS** — Prisma treats rename as drop + add, losing all data.

Safe approach — three migrations:

```bash
# Migration 1: add the new column (nullable)
npx prisma migrate dev --name add-payer-reference-column

# Migration 2: data backfill (run as a script or seed)
# UPDATE claims SET payer_reference = external_ref WHERE payer_reference IS NULL

# Migration 3: make new column non-nullable, drop old column
npx prisma migrate dev --name finalize-payer-reference-rename
```

### Deleting a column

**DANGEROUS** — data is permanently lost.

Before deletion: confirm the column is not referenced in any code, then create a
migration to drop it.

## Never edit committed migration files

Migration files in `prisma/migrations/` are immutable once committed to any shared
branch. Editing them causes `prisma migrate status` to report drift for all
teammates.

If you need to undo a migration:
1. In development only: `npx prisma migrate reset` (destroys all data — dev only)
2. On shared branches: create a new "undo" migration

## Docker PostgreSQL — connection string

```env
# .env.local
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/claims_db"
```

Start the database container:
```bash
docker run -d --name claims-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=claims_db \
  -p 5433:5432 \
  postgres:16
```

## Seeding development data

Seed script: `prisma/seed.ts`

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Idempotent — safe to run multiple times
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'SYSTEM_ADMIN',
      passwordHash: await hash('dev-password-123', 12),
      isActive: true,
    },
  });

  console.log('Seeded admin user:', admin.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Register the seed script in `package.json`:

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' prisma/seed.ts"
  }
}
```

Run: `npx prisma db seed`

Seed scripts must be idempotent — always use `upsert` or check for existence before
creating. Never use `create` in seed scripts.

## Production / CI migrations

In CI and production, use `prisma migrate deploy` (not `migrate dev`):

```bash
# In CI/CD pipeline or Vercel build step
npx prisma migrate deploy
```

`migrate deploy` applies pending migrations without prompting, and never creates
new migration files.

## Prisma schema conventions for this project

```prisma
model ExampleEntity {
  id          String   @id @default(cuid())   // CUIDs, not UUIDs or auto-increment
  userId      String                          // FK stored as String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())        // Always include timestamps
  updatedAt   DateTime @updatedAt

  @@map("example_entities")                   // snake_case table names via @@map
}
```

Rules:
- All PKs are `String @id @default(cuid())` — not Int auto-increment or UUID
- All tables have `createdAt` and `updatedAt`
- All table names use snake_case via `@@map()`
- All FK relations specify `onDelete` behavior explicitly (Cascade, Restrict, or SetNull)
- New columns must be nullable OR have a `@default()` value when added to existing tables
