---
name: tdd
description: >
  Red-Green-Refactor TDD for Next.js Route Handlers + React (RTL). Use when
  implementing features or fixing bugs. Covers vertical slice workflow, .skip
  removal, Route Handler (Jest + node-mocks-http) and React Testing Library
  examples, and anti-patterns.
---

# TDD Skill — Red-Green-Refactor for Next.js Full-Stack

This project uses strict TDD. Every behavior is tested before it is implemented.

## The Red-Green-Refactor Cycle

1. **RED** — Remove one `.skip` from a test stub. Run it. Confirm it fails.
2. **GREEN** — Write the minimum code needed to make ONLY that test pass. Run it. Confirm pass.
3. **REFACTOR** — Clean up without changing behavior. Re-run to confirm still green.

Then move to the next test.

## Vertical slices only — one behavior at a time

A vertical slice is one end-to-end behavior: one Route Handler endpoint, one page/component
state, one server action.

Implement slices in this order:
1. Happy path (valid input → expected output)
2. Error path (invalid input, missing resource, auth failure)
3. Edge cases (empty list, null values, boundary conditions)

Never implement a whole route file at once. Never write all tests first, then all code.

## How to remove .skip correctly

The test-case-generator creates stubs with `it.skip(...)`. To work through them:

```typescript
// BEFORE (stub):
it.skip('given valid payload and valid session, creates entity and returns 201', async () => {
  // ...
});

// STEP 1: Remove only this one .skip:
it('given valid payload and valid session, creates entity and returns 201', async () => {
  // ...
});

// STEP 2: Run the test — confirm RED:
// pnpm jest --testPathPattern="route" --watchAll=false

// STEP 3: Write the minimum implementation to pass.

// STEP 4: Run again — confirm GREEN.

// STEP 5: Only then remove the next .skip.
```

Never uncomment multiple `.skip` at once.

## Backend example — Next.js Route Handler (Jest + node-mocks-http)

**Write/enable the test (RED):**

```typescript
// __tests__/api/claims/route.test.ts
import { POST } from '@/app/api/claims/route';
import { createMocks } from 'node-mocks-http';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    claim: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  },
}));

const mockSession = {
  user: { id: 'user-uuid-123', email: 'test@example.com', role: 'CLAIMS_PROCESSOR' },
};

it('given valid payload and valid session, creates claim and returns 201', async () => {
  (getServerSession as jest.Mock).mockResolvedValue(mockSession);
  (prisma.claim.create as jest.Mock).mockResolvedValue({
    id: 'claim-uuid-1',
    claimNumber: 'CLM-001',
    status: 'SUBMITTED',
    submittedById: 'user-uuid-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

  const req = new Request('http://localhost/api/claims', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId: 'patient-uuid',
      serviceDate: '2026-01-15T00:00:00.000Z',
      payerName: 'Blue Shield',
      submittedAmount: 1500,
      diagnosisCode: 'Z00.00',
      procedureCode: '99213',
    }),
  });

  const res = await POST(req);
  const body = await res.json();

  expect(res.status).toBe(201);
  expect(body.claimNumber).toBe('CLM-001');
});
```

Run: `pnpm jest --testPathPattern="api/claims/route" --watchAll=false`
Expected: FAIL (route does not exist)

**Implement the minimum (GREEN):**

```typescript
// app/api/claims/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createClaimSchema } from '@/lib/validations/claims';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const parsed = createClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const claim = await prisma.claim.create({
    data: { ...parsed.data, submittedById: session.user.id, status: 'SUBMITTED', claimNumber: 'CLM-001' },
  });
  return NextResponse.json(claim, { status: 201 });
}
```

Run again: PASS. Now remove the next `.skip`.

## Frontend example — React component (React Testing Library)

**Enable the test (RED):**

```typescript
// __tests__/components/ClaimsTable.test.tsx
import { render, screen } from '@testing-library/react';
import { ClaimsTable } from '@/components/claims/ClaimsTable';

it('given initial render with claims, shows claim number in table', () => {
  render(
    <ClaimsTable
      claims={[
        {
          id: '1',
          claimNumber: 'CLM-001',
          status: 'SUBMITTED',
          payerName: 'Blue Shield',
          submittedAmount: 1500,
          createdAt: '2026-01-15T00:00:00.000Z',
        },
      ]}
    />
  );
  expect(screen.getByText('CLM-001')).toBeInTheDocument();
});
```

Run: `pnpm jest --testPathPattern="ClaimsTable" --watchAll=false`
Expected: FAIL (component does not exist)

**Implement the minimum (GREEN):**

```typescript
// components/claims/ClaimsTable.tsx
export function ClaimsTable({ claims }: { claims: { id: string; claimNumber: string; status: string; payerName: string; submittedAmount: number; createdAt: string }[] }) {
  return (
    <table>
      <tbody>
        {claims.map((c) => (
          <tr key={c.id}>
            <td>{c.claimNumber}</td>
            <td>{c.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Run again: PASS. Remove next `.skip`.

## Describe/it naming — "given / when / then"

```typescript
describe('POST /api/claims', () => {
  it('given valid payload and valid session, creates claim and returns 201');
  it('given missing session, returns 401');
  it('given invalid payload, returns 422 with validation issues');
  it('given duplicate claim number, returns 409');
});

describe('ClaimsTable', () => {
  it('given claims array, renders one row per claim');
  it('given empty array, renders empty state message');
  it('given status SUBMITTED, renders blue badge');
});
```

## Anti-patterns — never do these

| Anti-pattern | Why it is wrong |
|---|---|
| Uncomment 3+ `.skip` tests at once | Cannot tell which failing test to fix |
| Write the full implementation before any test | Lose the feedback loop entirely |
| Change a test assertion to make it pass | Testing implementation, not behavior |
| Write "just in case" code not required by current test | YAGNI — over-engineering before validation |
| Fix a failing test by deleting or commenting it out | Never acceptable |
| Implement full CRUD before any single endpoint test passes | All tests fail at once; impossible to diagnose |
| Use `fetch()` in a Route Handler test — call the exported function directly | `fetch()` in tests exercises the HTTP layer unnecessarily; import and call the handler |

## Coverage targets

- Route Handlers: 80% minimum
- Server-side service/lib functions: 80% minimum
- React components (RTL): 60% minimum
- Utility functions: 80% minimum

Run: `pnpm jest --coverage --watchAll=false`
