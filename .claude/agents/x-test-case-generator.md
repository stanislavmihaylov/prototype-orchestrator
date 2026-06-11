---
name: test-case-generator
description: >
  On-demand: generates concrete Jest test stub files for a feature (actual .ts/.tsx
  files with it.skip calls) for backend (NestJS + Supertest), mobile (RNTL), and types.
  Not part of the standard pipeline — invoke directly when you want pre-written stubs
  before implementation begins.
model: sonnet
tools: [Read, Write, Bash]
---

# Test Case Generator

You generate concrete, runnable test stub files. Each file must be valid TypeScript that can be parsed by Jest — even though all tests are skipped, the file must compile.

## Step 1: Read the feature plan

Read the full flow spec from disk first — the pipeline state summary may be truncated:

```
Read: docs/blueprint/flows/<feature-slug>.md
```

The plan summary from pipeline state (`feature_plan`) is supplementary context. If the flow spec file does not exist, use the plan summary only.

Also check for existing test infrastructure:

```bash
# Check existing test setup in backend
find apps/backend/src -name "jest.config.*" -o -name "test-utils.*" | head -5
cat apps/backend/src/test-utils.ts 2>/dev/null || echo "no test-utils yet"

# Check existing test setup in mobile
find apps/mobile/src -name "jest.config.*" -o -name "test-utils.*" | head -5
cat apps/mobile/src/test-utils.tsx 2>/dev/null || echo "no test-utils yet"

# Check packages/types structure
ls packages/types/src/ 2>/dev/null || echo "types package not initialized"
```

## Step 3: Create directory structure

```bash
mkdir -p apps/backend/src/<module>/__tests__
mkdir -p apps/mobile/src/features/<feature>/__tests__
mkdir -p packages/types/src/__tests__
```

## Step 4: Write backend test stubs

### `apps/backend/src/<module>/__tests__/<module>.controller.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { <Module>Module } from '../<module>.module';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/mock-prisma';
import { createTestJwt } from '../../test/jwt-factory';

describe('<Module>Controller (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;
  const testUserId = 'test-user-id-123';
  const validJwt = createTestJwt({ sub: testUserId });

  beforeAll(async () => {
    mockPrisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [<Module>Module],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // POST /api/<resource> — create entity
  // ---------------------------------------------------------------------------

  describe('POST /api/<resource>', () => {
    it.skip('given valid payload and valid JWT, creates entity and returns 201', async () => {
      // Arrange: mock prisma.<entity>.create to return a fixture
      // Act: POST /api/<resource> with Authorization: Bearer <validJwt>
      // Assert: status 201, response matches <Entity>ResponseDto shape
    });

    it.skip('given missing required field, returns 400 with validation error', async () => {
      // Arrange: payload missing required field
      // Act: POST /api/<resource>
      // Assert: status 400, body.message contains field name
    });

    it.skip('given no JWT, returns 401', async () => {
      // Arrange: no Authorization header
      // Act: POST /api/<resource>
      // Assert: status 401
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/<resource> — list entities for user
  // ---------------------------------------------------------------------------

  describe('GET /api/<resource>', () => {
    it.skip('given authenticated user with existing entities, returns 200 with array', async () => {
      // Arrange: mock prisma.<entity>.findMany to return 2 fixtures
      // Act: GET /api/<resource> with valid JWT
      // Assert: status 200, body is array of length 2
    });

    it.skip('given authenticated user with no entities, returns 200 with empty array', async () => {
      // Arrange: mock prisma.<entity>.findMany to return []
      // Act: GET /api/<resource>
      // Assert: status 200, body is []
    });

    it.skip('given no JWT, returns 401', async () => {
      // Arrange: no Authorization header
      // Assert: status 401
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/<resource>/:id
  // ---------------------------------------------------------------------------

  describe('GET /api/<resource>/:id', () => {
    it.skip('given existing entity owned by user, returns 200 with entity', async () => {
      // Arrange: mock prisma.<entity>.findFirst to return a fixture
      // Assert: status 200, body.id matches
    });

    it.skip('given entity that does not exist, returns 404', async () => {
      // Arrange: mock prisma.<entity>.findFirst to return null
      // Assert: status 404
    });

    it.skip('given entity owned by different user, returns 404 (not 403 — avoid leaking existence)', async () => {
      // Arrange: mock returns null when userId does not match
      // Assert: status 404
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/<resource>/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /api/<resource>/:id', () => {
    it.skip('given valid update payload and ownership, returns 200 with updated entity', async () => {
      // Arrange: mock findFirst (ownership check) + mock update
      // Assert: status 200, body reflects updated fields
    });

    it.skip('given entity not owned by user, returns 404', async () => {
      // Arrange: mock findFirst returns null
      // Assert: status 404
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/<resource>/:id
  // ---------------------------------------------------------------------------

  describe('DELETE /api/<resource>/:id', () => {
    it.skip('given existing entity owned by user, returns 200 with { deleted: true }', async () => {
      // Arrange: mock findFirst (ownership) + mock delete
      // Assert: status 200, body.deleted === true
    });

    it.skip('given entity not owned by user, returns 404', async () => {
      // Assert: status 404
    });
  });
});
```

### `apps/backend/src/<module>/__tests__/<module>.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { <Module>Service } from '../<module>.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/mock-prisma';

describe('<Module>Service', () => {
  let service: <Module>Service;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'test-user-id';

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        <Module>Service,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<<Module>Service>(<Module>Service);
  });

  // ---------------------------------------------------------------------------
  // create<Entity>
  // ---------------------------------------------------------------------------

  describe('create<Entity>', () => {
    it.skip('given valid dto, calls prisma.<entity>.create and returns mapped response', async () => {
      // Arrange: mock prisma.<entity>.create resolves with fixture
      // Act: service.create<Entity>(userId, dto)
      // Assert: prisma.<entity>.create called with { data: { ...dto, userId } }
      //         returned value matches <Entity>ResponseDto shape
    });
  });

  // ---------------------------------------------------------------------------
  // find<Entity>sByUser
  // ---------------------------------------------------------------------------

  describe('find<Entity>sByUser', () => {
    it.skip('calls prisma with userId filter and orderBy createdAt desc', async () => {
      // Arrange: mock findMany returns []
      // Act: service.find<Entity>sByUser(userId)
      // Assert: prisma.<entity>.findMany called with correct where + orderBy
    });
  });

  // ---------------------------------------------------------------------------
  // find<Entity>ById
  // ---------------------------------------------------------------------------

  describe('find<Entity>ById', () => {
    it.skip('given existing entity owned by user, returns mapped response', async () => {
      // Arrange: mock findFirst resolves with fixture
      // Assert: returns correct DTO
    });

    it.skip('given entity not found or wrong owner, throws NotFoundException', async () => {
      // Arrange: mock findFirst resolves with null
      // Assert: throws NotFoundException
    });
  });

  // ---------------------------------------------------------------------------
  // update<Entity>
  // ---------------------------------------------------------------------------

  describe('update<Entity>', () => {
    it.skip('given ownership confirmed, calls prisma.update and returns updated DTO', async () => {
      // Arrange: mock findFirst (ownership) resolves, mock update resolves with updated fixture
      // Assert: correct prisma calls, correct returned DTO
    });
  });

  // ---------------------------------------------------------------------------
  // delete<Entity>
  // ---------------------------------------------------------------------------

  describe('delete<Entity>', () => {
    it.skip('given ownership confirmed, calls prisma.delete and returns { deleted: true }', async () => {
      // Arrange: mock findFirst, mock delete
      // Assert: { deleted: true }
    });
  });
});
```

## Step 5: Write mobile test stubs

### `apps/mobile/src/features/<feature>/__tests__/<Feature>ListScreen.test.tsx`

```typescript
import React from 'react';
import { renderWithProviders, fireEvent, waitFor } from '../../../test-utils';
import { <Feature>ListScreen } from '../screens/<Feature>ListScreen';
import { use<Feature>Store } from '../stores/use<Feature>Store';

// Mock the store
jest.mock('../stores/use<Feature>Store');
const mockUse<Feature>Store = use<Feature>Store as jest.MockedFunction<typeof use<Feature>Store>;

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe('<Feature>ListScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it.skip('given store has items, renders list of item cards', () => {
    // Arrange: mockUse<Feature>Store returns { items: [fixture1, fixture2], status: 'success' }
    // Act: renderWithProviders(<<Feature>ListScreen />)
    // Assert: getByText(fixture1.title) and getByText(fixture2.title) present
  });

  it.skip('given store status is loading, renders loading indicator', () => {
    // Arrange: mockUse<Feature>Store returns { items: [], status: 'loading' }
    // Assert: getByTestId('loading-indicator') present
  });

  it.skip('given store has no items and status is success, renders empty state', () => {
    // Arrange: mockUse<Feature>Store returns { items: [], status: 'success' }
    // Assert: getByText(/no <entities> yet/i) present
  });

  it.skip('given store status is error, renders error message with retry button', () => {
    // Arrange: mockUse<Feature>Store returns { items: [], status: 'error', error: 'Failed to load' }
    // Assert: getByText('Failed to load') present
    //         getByText('Retry') present
  });

  it.skip('tapping a list item navigates to detail screen with correct id', () => {
    // Arrange: mockUse<Feature>Store returns { items: [fixture], status: 'success' }
    // Act: fireEvent.press(getByTestId('item-<fixture.id>'))
    // Assert: mockNavigate called with ('<Feature>Detail', { id: fixture.id })
  });

  it.skip('tapping create button navigates to create screen', () => {
    // Act: fireEvent.press(getByTestId('create-button'))
    // Assert: mockNavigate called with ('Create<Feature>')
  });
});
```

### `apps/mobile/src/features/<feature>/__tests__/use<Feature>Store.test.ts`

```typescript
import { renderHook, act } from '@testing-library/react-native';
import { use<Feature>Store } from '../stores/use<Feature>Store';

// Store actions receive getToken as a parameter — no react-native-auth0 mock needed here.
// Screens are responsible for calling useAuth0 and passing getToken to store actions.
const mockGetToken = jest.fn().mockResolvedValue('mock-access-token');

// Mock fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('use<Feature>Store', () => {
  beforeEach(() => {
    // Reset store state between tests
    use<Feature>Store.setState({
      items: [],
      selectedItem: null,
      status: 'idle',
      error: null,
    });
    jest.clearAllMocks();
  });

  describe('fetch<Feature>s', () => {
    it.skip('sets status to loading, then success, and populates items', async () => {
      // Arrange: mockFetch resolves with [fixture1, fixture2]
      // Act: const { result } = renderHook(() => use<Feature>Store())
      //      await act(() => result.current.fetch<Feature>s(mockGetToken))
      // Assert: status transitions idle → loading → success
      //         items = [fixture1, fixture2]
    });

    it.skip('attaches Authorization: Bearer header from getToken result', async () => {
      // Arrange: mockFetch resolves with []
      // Act: await act(() => result.current.fetch<Feature>s(mockGetToken))
      // Assert: mockFetch called with headers including Authorization: 'Bearer mock-access-token'
      //         mockGetToken was called once
    });

    it.skip('on network error, sets status to error and populates error message', async () => {
      // Arrange: mockFetch rejects with new Error('Network error')
      // Act: await act(() => result.current.fetch<Feature>s(mockGetToken))
      // Assert: status === 'error', error === 'Network error'
    });
  });

  describe('create<Feature>', () => {
    it.skip('on success, adds new item to items array and sets status success', async () => {
      // Arrange: mockFetch (POST) resolves with newFixture
      // Act: await act(() => result.current.create<Feature>({ ...validPayload }, mockGetToken))
      // Assert: items includes newFixture, status === 'success'
    });

    it.skip('on server error (400), sets status error with server message', async () => {
      // Arrange: mockFetch resolves with { ok: false, json: () => ({ error: 'Validation failed' }) }
      // Act: await act(() => result.current.create<Feature>({ ...validPayload }, mockGetToken))
      // Assert: status === 'error', error === 'Validation failed'
    });
  });
});
```

## Step 6: Write types test stubs

### `packages/types/src/__tests__/<feature>.types.test.ts`

```typescript
// Type contract tests — these verify the shape of our shared types
// using TypeScript type assertions (compile-time checks)

import type {
  Create<Entity>Request,
  <Entity>Response,
  ApiError,
} from '../index';

describe('<Feature> type contracts', () => {
  it.skip('Create<Entity>Request has required fields of correct types', () => {
    // This test exercises TypeScript type checking
    const validRequest: Create<Entity>Request = {
      // populate all required fields here
    };
    // If this file compiles, the type contract is satisfied
    expect(validRequest).toBeDefined();
  });

  it.skip('<Entity>Response has id, userId, and timestamps as strings', () => {
    const validResponse: <Entity>Response = {
      id: 'uuid-string',
      userId: 'user-uuid-string',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // ... other required fields
    };
    expect(validResponse.id).toBeDefined();
  });

  it.skip('ApiError has error, code, and statusCode', () => {
    const error: ApiError = {
      error: 'Not found',
      code: 'ENTITY_NOT_FOUND',
      statusCode: 404,
    };
    expect(error.statusCode).toBe(404);
  });
});
```

## Step 7: Verify files compile

```bash
# Verify TypeScript parses the new stubs (ignoring implementation gaps)
pnpm --filter backend exec tsc --noEmit --skipLibCheck 2>&1 | head -30
pnpm --filter mobile exec tsc --noEmit --skipLibCheck 2>&1 | head -30
pnpm --filter @repo/types exec tsc --noEmit 2>&1 | head -30
```

Fix any TypeScript parse errors in the stubs before finishing. Import statement errors are acceptable if the imported module doesn't exist yet — note them.

## Output summary

```
Test stubs created:

Backend:
  apps/backend/src/<module>/__tests__/<module>.controller.spec.ts  (X tests, all .skip)
  apps/backend/src/<module>/__tests__/<module>.service.spec.ts     (X tests, all .skip)

Mobile:
  apps/mobile/src/features/<feature>/__tests__/<Feature>ListScreen.test.tsx  (X tests, all .skip)
  apps/mobile/src/features/<feature>/__tests__/use<Feature>Store.test.ts     (X tests, all .skip)

Types:
  packages/types/src/__tests__/<feature>.types.test.ts  (X tests, all .skip)

Total: X test stubs across Y files.

⚠️ INTERRUPT #1: Human review required
Please review the plan (from plan-feature output) and these test stubs.
Approve to proceed to implementation, or provide feedback to revise.
```
