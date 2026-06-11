---
name: test-patterns
description: >
  Testing patterns for a Next.js 14 App Router project. Covers Route Handler
  unit tests (Jest + next/server mocks), React component tests (RTL), Prisma
  mocking, NextAuth.js session mocking, Zod validation testing, and naming
  conventions. Use when writing or diagnosing Jest/RTL tests.
---

# Test Patterns — Next.js + React Testing Library

## Route Handler unit tests

Route Handlers are plain async functions — call them directly in tests. Do not
spin up a server. Mock `getServerSession` and `prisma` at the module level.

```typescript
// __tests__/api/claims/route.test.ts
import { GET, POST } from '@/app/api/claims/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

// Mock NextAuth session
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

// Mock Prisma client
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

describe('GET /api/claims', () => {
  afterEach(() => jest.clearAllMocks());

  it('given valid session, returns claims list', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(mockSession);
    (prisma.claim.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'claim-1',
        claimNumber: 'CLM-001',
        status: 'SUBMITTED',
        submittedById: 'user-uuid-123',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    const req = new Request('http://localhost/api/claims');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].claimNumber).toBe('CLM-001');
  });

  it('given no session, returns 401', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const req = new Request('http://localhost/api/claims');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

describe('POST /api/claims', () => {
  afterEach(() => jest.clearAllMocks());

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

  it('given invalid payload, returns 422', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(mockSession);

    const req = new Request('http://localhost/api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payerName: '' }), // missing required fields
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
```

## Jest configuration for Next.js

```javascript
// jest.config.js
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',      // for Route Handler tests
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@repo/types$': '<rootDir>/packages/types/src/index.ts',
  },
};

module.exports = createJestConfig(customJestConfig);
```

For React component tests, override the environment per file or use a separate
config with `testEnvironment: 'jsdom'`.

## React component tests (RTL)

```typescript
// __tests__/components/claims/ClaimsTable.test.tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ClaimsTable } from '@/components/claims/ClaimsTable';
import type { ClaimResponse } from '@repo/types';

const mockClaims: ClaimResponse[] = [
  {
    id: 'claim-1',
    claimNumber: 'CLM-001',
    status: 'SUBMITTED',
    payerName: 'Blue Shield',
    submittedAmount: 1500,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
  },
];

describe('ClaimsTable', () => {
  it('given claims array, renders one row per claim', () => {
    render(<ClaimsTable claims={mockClaims} />);
    expect(screen.getByText('CLM-001')).toBeInTheDocument();
  });

  it('given empty array, renders empty state message', () => {
    render(<ClaimsTable claims={[]} />);
    expect(screen.getByText(/no claims yet/i)).toBeInTheDocument();
  });

  it('given user clicks a row, calls onSelect with claim id', () => {
    const onSelect = jest.fn();
    render(<ClaimsTable claims={mockClaims} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('CLM-001'));
    expect(onSelect).toHaveBeenCalledWith('claim-1');
  });
});
```

## Mocking NextAuth.js session in component tests

```typescript
// For Client Components that call useSession():
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: { id: 'user-uuid-123', email: 'test@example.com', role: 'CLAIMS_PROCESSOR', name: 'Test User' },
    },
    status: 'authenticated',
  }),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));
```

For Server Component tests (rare — prefer RTL for UI, Jest for Route Handlers):

```typescript
jest.mock('next-auth', () => ({
  getServerSession: jest.fn().mockResolvedValue({
    user: { id: 'user-uuid-123', email: 'test@example.com', role: 'CLAIMS_PROCESSOR' },
  }),
}));
```

## Mocking Prisma in Route Handler tests

Use a module-level mock. Reset mocks in `afterEach`:

```typescript
jest.mock('@/lib/prisma', () => ({
  prisma: {
    claim: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((fn) => fn(prisma)),
  },
}));
```

## jest.setup.ts — global setup

```typescript
// jest.setup.ts
import '@testing-library/jest-dom';

// Mock Next.js navigation hooks for component tests
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

// Global fetch mock — override per-test as needed
global.fetch = jest.fn();
```

## Zod validation testing

Test Zod schemas independently before testing Route Handlers:

```typescript
// __tests__/lib/validations/claims.test.ts
import { createClaimSchema } from '@/lib/validations/claims';

describe('createClaimSchema', () => {
  it('given valid payload, returns parsed data', () => {
    const result = createClaimSchema.safeParse({
      patientId: 'cuid-123',
      serviceDate: '2026-01-15T00:00:00.000Z',
      payerName: 'Blue Shield',
      submittedAmount: 1500,
      diagnosisCode: 'Z00.00',
      procedureCode: '99213',
    });
    expect(result.success).toBe(true);
  });

  it('given negative submittedAmount, returns error', () => {
    const result = createClaimSchema.safeParse({
      patientId: 'cuid-123',
      serviceDate: '2026-01-15T00:00:00.000Z',
      payerName: 'Blue Shield',
      submittedAmount: -1,
      diagnosisCode: 'Z00.00',
      procedureCode: '99213',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('submittedAmount');
  });
});
```

## Naming convention: given / when / then

All tests follow this pattern:

```typescript
// Route Handler tests
describe('POST /api/claims', () => {
  it('given valid payload and valid session, creates claim and returns 201');
  it('given missing session, returns 401');
  it('given invalid payload, returns 422 with validation issues');
});

// Component tests
describe('ClaimsTable', () => {
  it('given claims array, renders one row per claim');
  it('given empty array, renders empty state message');
  it('given status SUBMITTED, renders blue badge');
});

// Service / lib function tests
describe('generateClaimNumber', () => {
  it('given existing claims in DB, returns next sequential number');
  it('given no existing claims, returns CLM-0001');
});
```

## Coverage targets

| Layer | Minimum |
|---|---|
| Route Handlers | 80% |
| lib/ service functions | 80% |
| React components (RTL) | 60% |
| Utility functions | 80% |
| Zod schemas | Not tracked — tested via Route Handler tests |

Run: `pnpm jest --coverage --watchAll=false`
