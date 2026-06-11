---
name: nextjs-patterns
description: >
  Next.js 14 App Router patterns for this project: Route Handlers as the API
  layer, React Server Components for data fetching, Tailwind CSS for styling,
  Prisma ORM for database access, and Zod for request validation.
---

# Next.js 14 App Router Patterns

## Project structure

```
apps/web/
  app/
    (auth)/
      sign-in/
        page.tsx           — public sign-in page
    (internal)/
      layout.tsx           — protected layout (checks session)
      dashboard/
        page.tsx
      claims/
        page.tsx           — Claims List
        [id]/
          page.tsx         — Claim Detail
        new/
          page.tsx         — Submit New Claim
    (portal)/
      layout.tsx           — external user portal layout
      portal/
        claims/
          page.tsx
          [id]/
            page.tsx
    api/
      auth/
        [...nextauth]/
          route.ts         — NextAuth.js handler
      claims/
        route.ts           — GET (list) + POST (create)
        [id]/
          route.ts         — GET + PATCH + DELETE
          status/
            route.ts       — PATCH (status transition)
          documents/
            route.ts       — POST (upload)
      dashboard/
        route.ts           — GET aggregate KPIs
      audit/
        route.ts           — GET global audit log
      notifications/
        route.ts           — GET list + POST mark-all-read
        [id]/
          read/
            route.ts       — PATCH mark one read
      users/
        route.ts           — GET list + POST invite
        [id]/
          route.ts         — PATCH + DELETE
    layout.tsx             — root layout (fonts, providers)
    globals.css
  components/
    ui/                    — shared primitive components (Button, Badge, etc.)
    claims/                — claim-specific components
    layout/                — nav, sidebar, header
  lib/
    prisma.ts              — Prisma singleton
    auth.ts                — NextAuth.js config
    validations/           — Zod schemas
  prisma/
    schema.prisma
    migrations/
```

## Route Handler pattern

```typescript
// app/api/claims/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createClaimSchema } from '@/lib/validations/claims';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const claims = await prisma.claim.findMany({
    where: buildClaimFilter(session.user.role, session.user.id),
    orderBy: { createdAt: 'desc' },
    include: { patient: true, submittedBy: { select: { name: true } } },
  });

  return NextResponse.json(claims);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const claim = await prisma.claim.create({
    data: {
      ...parsed.data,
      submittedById: session.user.id,
      status: 'SUBMITTED',
      claimNumber: await generateClaimNumber(),
    },
  });

  // Write audit log inline — never optional
  await prisma.auditLog.create({
    data: {
      claimId: claim.id,
      actorId: session.user.id,
      action: 'CLAIM_SUBMITTED',
      toStatus: 'SUBMITTED',
      detail: `Claim ${claim.claimNumber} submitted`,
    },
  });

  return NextResponse.json(claim, { status: 201 });
}
```

## Prisma singleton

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

## Zod validation schemas

```typescript
// lib/validations/claims.ts
import { z } from 'zod';

export const createClaimSchema = z.object({
  patientId: z.string().cuid(),
  serviceDate: z.string().datetime(),
  payerName: z.string().min(1).max(255),
  payerId: z.string().optional(),
  providerNpi: z.string().optional(),
  submittedAmount: z.number().positive(),
  diagnosisCode: z.string().min(1),
  procedureCode: z.string().min(1),
  notes: z.string().optional(),
});

export const transitionStatusSchema = z.object({
  status: z.enum([
    'SUBMITTED', 'UNDER_REVIEW', 'PENDING_ADDITIONAL_DATA', 'VALIDATED',
    'ADJUDICATED_ACCEPTED', 'SETTLEMENT_OFFERED', 'PAYMENT_RECORDED',
    'CLOSED', 'REJECTED', 'REJECTION_UNDER_REVIEW',
  ]),
  notes: z.string().optional(),
  approvedAmount: z.number().positive().optional(),
});
```

## Server Component data fetching

```typescript
// app/(internal)/claims/page.tsx — Server Component
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ClaimsTable } from '@/components/claims/ClaimsTable';
import { redirect } from 'next/navigation';

export default async function ClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/sign-in');

  const claims = await prisma.claim.findMany({
    where: { submittedById: session.user.id },
    include: { patient: true },
    orderBy: { createdAt: 'desc' },
  });

  return <ClaimsTable claims={claims} />;
}
```

## Middleware for route protection

```typescript
// middleware.ts (project root)
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Role-based route guards
    if (path.startsWith('/admin') && token?.role !== 'SYSTEM_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    if (path.startsWith('/portal') && !['PATIENT', 'HEALTHCARE_PROVIDER'].includes(token?.role as string)) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|sign-in|favicon.ico).*)',
  ],
};
```

## Ownership check rule

Every Prisma query that retrieves by ID must scope to the session user. Never trust an ID without ownership verification:

```typescript
// CORRECT
const claim = await prisma.claim.findFirst({
  where: { id: claimId, submittedById: session.user.id },
});
if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });

// WRONG — never do this
const claim = await prisma.claim.findUnique({ where: { id: claimId } });
```

Exception: CLAIMS_MANAGER and SYSTEM_ADMIN roles may query without user scoping (they see all records). Use a helper:

```typescript
function buildClaimFilter(role: string, userId: string) {
  if (role === 'CLAIMS_MANAGER' || role === 'SYSTEM_ADMIN') return {};
  return { submittedById: userId };
}
```

## Tailwind CSS conventions

- Use Tailwind utility classes directly in JSX. Do not write custom CSS unless animating.
- Use `cn()` helper (from `clsx` + `tailwind-merge`) for conditional classes:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- Colour tokens from `tailwind.config.ts` — never hardcode hex values.
- Status badge colours:

| Status | Classes |
|--------|---------|
| SUBMITTED | `bg-blue-100 text-blue-800` |
| UNDER_REVIEW | `bg-yellow-100 text-yellow-800` |
| VALIDATED | `bg-green-100 text-green-800` |
| REJECTED | `bg-red-100 text-red-800` |
| CLOSED | `bg-gray-100 text-gray-800` |

## Migration workflow

```bash
# Generate a migration from schema changes
npx prisma migrate dev --name add-<entity-name>

# Apply migrations in CI / production
npx prisma migrate deploy

# Regenerate Prisma client after schema change
npx prisma generate

# Seed the database
npx prisma db seed
```

Safety rules:
- New columns must be nullable OR have a `@default()` value
- Never add a non-nullable column without default to an existing table
- Always run `prisma migrate status` after deployment to confirm pending migrations are applied

## Anti-patterns

- Never use `fetch()` inside a Server Component — use Prisma directly.
- Never import `prisma` in a Client Component — use Route Handlers or Server Actions.
- Never put business logic in `page.tsx` — keep pages thin; move logic to Route Handlers or service modules in `lib/`.
- Never skip the `getServerSession()` check in a Route Handler — every handler that touches data must verify the session.
- Never expose the full Prisma model in a response if it contains sensitive fields — use a `select` or `omit` object.
