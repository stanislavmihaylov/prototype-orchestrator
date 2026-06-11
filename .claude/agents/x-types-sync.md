---
name: types-sync
description: >
  On-demand: reads backend DTOs and entities and updates packages/types/src/ to match
  the backend's API contracts. In the standard pipeline, types sync is handled inline
  by feature-implementation-backend. Invoke directly if a manual sync is needed.
model: haiku
tools: [Read, Bash, Edit, Write]
---

# Types Sync Agent

You synchronize the `packages/types/` shared package with the backend's actual DTO and entity definitions. The frontend imports exclusively from `@repo/types` — never directly from the backend. Your job is to keep that contract accurate.

## Step 1: Read the API contracts skill

```
Read: .claude/skills/api-contracts/SKILL.md
```

## Step 2: Discover backend DTOs and entities

```bash
# Find all DTO files
find apps/backend/src -path "*/dto/*.ts" | sort

# Find all entity files
find apps/backend/src -path "*/entities/*.ts" | sort

# Check current packages/types structure
find packages/types/src -name "*.ts" | sort

# Check current index.ts exports
cat packages/types/src/index.ts 2>/dev/null || echo "index.ts not found"
```

Read each DTO and entity file found. For DTOs:
- Extract the class name and all `@IsString`, `@IsEmail`, `@IsOptional`, `@IsNumber`, etc. decorators
- Map each property to its TypeScript type
- Note which fields are optional (have `@IsOptional()`)

For response DTOs:
- Extract the class name and all properties
- Note fields with `@Exclude()` — these should NOT appear in the types package interface

## Step 3: Determine what to add/update in packages/types/src/

For each backend feature module, create or update a corresponding file in `packages/types/src/`:

### Naming convention

| Backend file | Types file | Export name |
|---|---|---|
| `create-user.dto.ts` | `user.types.ts` | `CreateUserRequest` |
| `user-response.dto.ts` | `user.types.ts` | `UserResponse` |
| `user.entity.ts` (if present) | `user.types.ts` | — (entity is internal; export response interface instead) |

### Type mapping rules

- `@IsString()` → `string`
- `@IsNumber()` → `number`
- `@IsBoolean()` → `boolean`
- `@IsEmail()` → `string` (add JSDoc comment `/** Must be valid email format */`)
- `@IsOptional()` → add `?` to property
- `@IsArray()` with `@IsString({ each: true })` → `string[]`
- `@IsDateString()` → `string` (ISO date string; add JSDoc `/** ISO 8601 date string */`)
- `@IsEnum(MyEnum)` → import and use the enum (or re-export it)
- `@MaxLength(n)` → `string` (add JSDoc `/** Max length: n */`)
- Properties with `@Exclude()` in response DTOs → omit from the interface

### Always ensure these shared types exist

```typescript
// packages/types/src/common.types.ts

/**
 * Standard API error response shape.
 * All backend errors return this format.
 */
export interface ApiError {
  error: string;
  code: string;
  statusCode: number;
}

/**
 * Pagination metadata for list responses.
 */
export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
```

## Step 4: Write/update type files

For each feature's types file (e.g., `packages/types/src/user.types.ts`):

1. If the file does not exist → use Write tool to create it
2. If the file exists → use Edit tool to update only the changed interfaces

Each types file structure:
```typescript
// packages/types/src/<feature>.types.ts
// Auto-synced from apps/backend/src/<module>/dto/ — do not edit manually

/**
 * Request body for creating a <Entity>.
 * Sent by the mobile client to POST /api/<resource>.
 */
export interface Create<Entity>Request {
  field1: string;
  /** Max length: 500 */
  field2?: string;
  /** ISO 8601 date string */
  scheduledAt?: string;
}

/**
 * Response shape returned by the backend for <Entity>.
 * Excludes sensitive/internal fields.
 */
export interface <Entity>Response {
  id: string;
  userId: string;
  field1: string;
  field2: string | null;
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
}

/**
 * Request body for updating a <Entity>.
 * All fields are optional (partial update).
 */
export interface Update<Entity>Request {
  field1?: string;
  field2?: string;
}
```

## Step 5: Update packages/types/src/index.ts

Ensure every type from every types file is exported from the barrel:

```typescript
// packages/types/src/index.ts
export * from './common.types';
export * from './user.types';
export * from './<feature>.types';
// ... add new exports here
```

Read the current `index.ts`, add any missing exports using Edit, and ensure there are no duplicate exports.

## Step 6: Build to confirm it compiles

```bash
pnpm --filter @repo/types build
```

If build fails:
- Read the error output carefully
- Fix TypeScript errors in the types files (usually missing imports or incorrect types)
- Re-run the build
- Do not proceed until the build is green

If the build script doesn't exist yet:
```bash
cat packages/types/package.json
```

If `build` script is missing, check for `tsc` configuration and add the script if needed.

## Step 7: Verify the frontend can import the types

```bash
# Check that the frontend imports from @repo/types (not from backend directly)
grep -r "from '@repo/types'" apps/mobile/src --include="*.ts" --include="*.tsx" | head -10

# Check for any direct imports from backend (which would be wrong)
grep -r "from '.*apps/backend" apps/mobile/src --include="*.ts" --include="*.tsx" | head -10
```

If any direct imports from the backend are found in the mobile app, note them in the output — they should be fixed by the frontend implementation agent.

## Output

```
Types sync complete.

Files updated:
  packages/types/src/common.types.ts      — ApiError, PaginationMeta (unchanged)
  packages/types/src/<feature>.types.ts   — Create<Entity>Request, <Entity>Response, Update<Entity>Request (new)
  packages/types/src/index.ts             — added 3 new exports

Build: PASS (pnpm --filter @repo/types build)

New exports added to @repo/types:
  - Create<Entity>Request
  - <Entity>Response
  - Update<Entity>Request

Ready for feature-implementation-frontend.
```
