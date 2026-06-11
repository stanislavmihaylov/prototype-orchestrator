---
name: api-contracts
description: >
  API contract workflow for this Next.js monorepo. The contract lives in
  packages/types/. Route Handlers define response shapes via Zod schemas;
  types-sync agent writes TypeScript interfaces to packages/types/; frontend
  Server and Client Components import from @repo/types. Covers naming
  conventions, versioning, and error format.
---

# API Contracts — Next.js Full-Stack

## The contract is in packages/types/

The single source of truth for all request/response shapes is `packages/types/src/`.
The Route Handler layer generates the contract; UI components and Client Components
consume it.

**Flow:**
```
Route Handlers define Zod schemas in app/lib/validations/
         ↓
types-sync agent reads those schemas and response shapes
         ↓
types-sync writes TypeScript interfaces to packages/types/src/
         ↓
Client Components / Server Components import from @repo/types
```

## Never duplicate type definitions

If a type exists in `packages/types/`, import it — do not copy-paste it.

```typescript
// CORRECT — import from @repo/types
import type { CreateClaimRequest, ClaimResponse } from '@repo/types';

// WRONG — redefining the interface in a component file
interface ClaimResponse {
  id: string;
  // ...
}
```

```typescript
// WRONG — importing directly from the app source
import type { ClaimResponse } from '../../../app/api/claims/route';
```

## Naming conventions

| Purpose | Zod schema (validation) | packages/types (interface) |
|---------|------------------------|---------------------------|
| Create request | `createClaimSchema` | `CreateClaimRequest` |
| Update request | `updateClaimSchema` | `UpdateClaimRequest` |
| Response | inline Route Handler return | `ClaimResponse` |
| List response | — | `ClaimResponse[]` |
| Error | — | `ApiError` |

## Standard error format

All API errors from Route Handlers return this shape. Defined in
`packages/types/src/common.types.ts`:

```typescript
export interface ApiError {
  error: string;      // Human-readable: "Claim not found"
  code?: string;      // Machine-readable: "CLAIM_NOT_FOUND"
  statusCode: number; // HTTP status: 404
}
```

Route Handlers return this shape on all non-2xx responses. Client Components
always check `response.ok` and parse the body as `ApiError` on failure.

```typescript
// Client Component fetch — always handle errors this way
try {
  const response = await fetch('/api/claims', { method: 'POST', body: JSON.stringify(data) });
  if (!response.ok) {
    const err: ApiError = await response.json();
    throw new Error(err.error);
  }
  const claim: ClaimResponse = await response.json();
  // update local state
} catch (error) {
  setError(error instanceof Error ? error.message : 'Request failed');
}
```

## Versioning and breaking changes

A breaking change is any change that causes existing component code to fail:
- Removing a field from a response
- Renaming a field
- Changing a field's type (e.g., `string` → `number`)
- Making an optional field required in a request

For breaking changes:
1. Bump the version in `packages/types/package.json`
2. Update all affected interfaces in `packages/types/src/`
3. Update Zod schemas in `app/lib/validations/`
4. Update all components and Server Components that use the changed type

Non-breaking changes (safe without a version bump):
- Adding an optional field to a response
- Adding an optional field to a request schema
- Adding a new Route Handler (new types file)

## packages/types structure

```
packages/types/
  src/
    index.ts              ← barrel — exports everything
    common.types.ts       ← ApiError, PaginationMeta, PaginatedResponse
    user.types.ts         ← UserResponse, UpdateUserRequest
    claim.types.ts        ← CreateClaimRequest, ClaimResponse, etc.
    dashboard.types.ts    ← DashboardKpis, etc.
  package.json
  tsconfig.json
```

`index.ts` must export every type:

```typescript
// packages/types/src/index.ts
export * from './common.types';
export * from './user.types';
export * from './claim.types';
export * from './dashboard.types';
```

## Dates in the API contract

Dates are always serialized as ISO 8601 strings in API responses — never as `Date`
objects (which are not JSON-serializable). Prisma `DateTime` fields become `string`
in the interface:

```typescript
// In packages/types — always string for dates
export interface ClaimResponse {
  id: string;
  claimNumber: string;
  status: string;
  /** ISO 8601 date string — e.g. "2026-01-15T10:30:00.000Z" */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
}
```

## Route Handlers must never return raw Prisma models

The Route Handler must never return a raw Prisma result if it contains sensitive
fields. Use a `select` object to shape the response:

```typescript
// WRONG — returns raw Prisma model including passwordHash
const user = await prisma.user.findUnique({ where: { id } });
return NextResponse.json(user);

// CORRECT — select only the fields needed
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, name: true, role: true, createdAt: true },
});
return NextResponse.json(user);
```
