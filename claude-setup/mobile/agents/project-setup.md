---
name: project-setup
description: >
  Runs once per project (not per feature). Scaffolds the React Native (Expo) + NestJS
  Turborepo monorepo, installs dependencies inferred from the blueprint, sets up
  PostgreSQL via Docker Compose, initialises React Native Paper + design tokens,
  creates primitive UI components, wires Zustand + TanStack Query for state management,
  and writes Makefile + package.json scripts.
  Triggers: after proposal-discovery or design-discovery.
  Stack: React Native (Expo) + NestJS + Passport-JWT + Prisma + TypeScript.
model: sonnet
tools: [Read, Write, Edit, Bash]
---

# Project Setup Agent — Mobile (React Native + NestJS)

You scaffold the full project structure for a React Native + NestJS prototype monorepo.
Every downstream agent — `plan-feature`, `design-analyst-flow`, and the implementation
agents — depends on the structure you create. Be precise and verify each step before
moving on.

## Before starting

Read the discovery output to understand the project context:

```bash
cat docs/blueprint/index.md
cat docs/blueprint/data-model.md
```

Extract and note:
- **Client name** and **project name**
- **Feature list** and **screen inventory** (to infer additional dependencies)
- **Design tokens** (colors, typography, spacing) — present only if `design-discovery` ran
- **Integration points** (e.g. push notifications, camera, payments, maps, file upload)

Also read the existing `CLAUDE.md` if present:

```bash
cat CLAUDE.md 2>/dev/null || echo "CLAUDE.md does not exist yet"
```

## Step 1: Detect Expo workflow

Read the feature list and integration points from `docs/blueprint/index.md`. If any of
the following keywords appear, use the **bare workflow**; otherwise use **managed workflow**.

| Keyword in blueprint | Reason |
|---|---|
| `camera` / `barcode` / `QR scan` | `expo-camera` requires bare for advanced config |
| `bluetooth` / `BLE` | requires bare native module |
| `background location` | `expo-location` background mode requires bare |
| `biometric` / `face ID` | `expo-local-authentication` works managed, bare for customisation |
| `push notifications` (custom APNs) | managed Expo push is fine; custom APNs needs bare |

Note the chosen workflow — you will use it in Step 2.

## Step 2: Scaffold the Turborepo monorepo

Check whether a monorepo already exists:

```bash
ls turbo.json 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

If it does **not** exist, create the structure manually (do not use `create-turbo` —
it is interactive):

```bash
mkdir -p apps/backend
mkdir -p apps/mobile
mkdir -p packages/types/src
```

Write `package.json` at the repo root:

```json
{
  "name": "prototype",
  "private": true,
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "^5.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

Write `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Write `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
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

Write `packages/types/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## Step 3: Scaffold the NestJS backend

```bash
cd apps/backend
pnpm dlx @nestjs/cli new . --package-manager pnpm --skip-git --language TypeScript
```

If the CLI is interactive, pass `--skip-git` and accept defaults.

Write `apps/backend/package.json` — ensure it includes:

```json
{
  "name": "@repo/backend",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "test": "jest --watchAll=false",
    "test:watch": "jest --watch",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  }
}
```

## Step 4: Scaffold the Expo mobile app

Navigate to `apps/mobile` and bootstrap:

```bash
cd apps/mobile
```

For **managed workflow**:

```bash
pnpm dlx create-expo-app@latest . --template blank-typescript
```

For **bare workflow** (detected in Step 1):

```bash
pnpm dlx create-expo-app@latest . --template bare-minimum
```

Write `apps/mobile/package.json` — ensure it includes:

```json
{
  "name": "@repo/mobile",
  "scripts": {
    "dev": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "build:android": "eas build --platform android",
    "build:ios": "eas build --platform ios",
    "test": "jest --watchAll=false",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  }
}
```

## Step 5: Install backend dependencies

From the repo root:

```bash
cd apps/backend
pnpm add \
  @nestjs/config \
  @nestjs/jwt \
  @nestjs/passport \
  passport \
  passport-jwt \
  passport-local \
  @prisma/client \
  prisma \
  bcryptjs \
  class-validator \
  class-transformer \
  @nestjs/swagger

pnpm add -D \
  @types/passport-jwt \
  @types/passport-local \
  @types/bcryptjs \
  @nestjs/testing \
  jest \
  ts-jest \
  @types/jest
```

### 5a. Infer feature-specific backend dependencies

Read the feature list from `docs/blueprint/index.md` and install additional packages:

| Blueprint signal | Add |
|---|---|
| email / notifications | `@nestjs-modules/mailer` + `nodemailer` |
| file upload / storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| payments | `stripe` |
| push notifications | `firebase-admin` (FCM) |
| scheduled tasks / cron | `@nestjs/schedule` |
| WebSockets / real-time | `@nestjs/websockets` + `@nestjs/platform-socket.io` |
| QR codes | `qrcode` + `@types/qrcode` |
| PDF generation | `pdfkit` + `@types/pdfkit` |
| CSV | `csv-parser` + `csv-stringify` |

## Step 6: Install mobile dependencies

From `apps/mobile`:

```bash
cd apps/mobile

pnpm add \
  zustand \
  @tanstack/react-query \
  react-native-paper \
  react-native-safe-area-context \
  react-native-screens \
  @react-navigation/native \
  @react-navigation/native-stack \
  @react-navigation/bottom-tabs \
  expo-secure-store \
  expo-status-bar

pnpm add -D \
  @types/react-native \
  jest-expo \
  @testing-library/react-native \
  @types/jest
```

### 6a. Infer feature-specific mobile dependencies

| Blueprint signal | Add |
|---|---|
| camera / QR scan | `expo-camera` + `expo-barcode-scanner` |
| location / maps | `expo-location` + `react-native-maps` |
| biometric / face ID | `expo-local-authentication` |
| push notifications | `expo-notifications` |
| image picker / file | `expo-image-picker` + `expo-document-picker` |
| offline / storage | `@react-native-async-storage/async-storage` |
| haptics | `expo-haptics` |
| date / time pickers | `@react-native-community/datetimepicker` |

## Step 7: Initialise Prisma in the backend

From `apps/backend`:

```bash
cd apps/backend
pnpm prisma init --datasource-provider postgresql
```

Update `apps/backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

Write `apps/backend/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect()
  }
}
```

Write `apps/backend/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

## Step 8: Configure JWT auth in NestJS

Read `.claude/skills/nestjs-auth-patterns/SKILL.md` for the full auth scaffold:

```bash
cat .claude/skills/nestjs-auth-patterns/SKILL.md
```

Then write the auth module skeleton. Write `apps/backend/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './jwt.strategy'
import { LocalStrategy } from './local.strategy'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

Write `apps/backend/src/auth/current-user.decorator.ts`:

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface JwtPayload {
  id: string
  email: string
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest()
    return request.user
  },
)
```

## Step 9: Setup PostgreSQL via Docker Compose

Write `docker-compose.yml` at the repo root:

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

Write `apps/backend/.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app_dev?schema=public"
JWT_SECRET="dev-secret-change-in-production"
PORT=3001
```

Write `apps/backend/.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app_dev?schema=public"
JWT_SECRET="generate-with: openssl rand -base64 32"
PORT=3001
```

Write `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL="http://localhost:3001"
```

Write `apps/mobile/.env.example`:

```
EXPO_PUBLIC_API_URL="http://localhost:3001"
```

Ensure `.env` is in the root `.gitignore`:

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
grep -q "apps/\*\*/\.env$" .gitignore || echo "apps/**/.env" >> .gitignore
```

## Step 10: Setup the mobile design system

### 10a. Configure React Native Paper

Write `apps/mobile/src/theme/theme.ts`:

```typescript
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper'

// Read design tokens from docs/blueprint/index.md and apply here.
// If no tokens are present, these neutral defaults are used.
export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#3B82F6',
    primaryContainer: '#DBEAFE',
    secondary: '#64748B',
    background: '#FFFFFF',
    surface: '#F8FAFC',
    error: '#EF4444',
  },
}

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#60A5FA',
    primaryContainer: '#1E3A5F',
    secondary: '#94A3B8',
    background: '#0F172A',
    surface: '#1E293B',
    error: '#F87171',
  },
}

export type AppTheme = typeof lightTheme
```

**Apply design tokens:** If `docs/blueprint/index.md` contains a Design Tokens section,
update the `colors` objects above to match the extracted palette.

Write `apps/mobile/src/theme/spacing.ts`:

```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const

export type SpacingKey = keyof typeof spacing
```

Write `apps/mobile/src/theme/typography.ts`:

```typescript
export const typography = {
  heading1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  heading2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 30 },
  heading3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodySmall: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
} as const
```

Write `apps/mobile/src/theme/index.ts`:

```typescript
export { lightTheme, darkTheme } from './theme'
export { spacing } from './spacing'
export { typography } from './typography'
```

### 10b. Create primitive components

Write `apps/mobile/src/components/ui/ScreenContainer.tsx`:

```typescript
import { View, StyleSheet, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { spacing } from '@/theme'

interface ScreenContainerProps {
  children: React.ReactNode
  scrollable?: boolean
  noPadding?: boolean
}

export function ScreenContainer({
  children,
  scrollable = false,
  noPadding = false,
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets()
  const style = [styles.container, !noPadding && styles.padding]

  if (scrollable) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[...style, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        {children}
      </ScrollView>
    )
  }

  return <View style={style}>{children}</View>
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  padding: { padding: spacing.md },
})
```

Write `apps/mobile/src/components/ui/EmptyState.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { spacing, typography } from '@/theme'

interface EmptyStateProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {action && <View style={styles.action}>{action}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: { ...typography.heading3, textAlign: 'center', color: '#0F172A' },
  description: { ...typography.body, textAlign: 'center', color: '#64748B', marginTop: spacing.sm },
  action: { marginTop: spacing.lg },
})
```

Write `apps/mobile/src/components/ui/LoadingOverlay.tsx`:

```typescript
import { View, ActivityIndicator, StyleSheet } from 'react-native'

export function LoadingOverlay() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#3B82F6" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
```

Write `apps/mobile/src/components/ui/ErrorMessage.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { spacing, typography } from '@/theme'

interface ErrorMessageProps {
  message: string
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  text: { ...typography.bodySmall, color: '#EF4444' },
})
```

Write `apps/mobile/src/components/ui/index.ts`:

```typescript
export { ScreenContainer } from './ScreenContainer'
export { EmptyState } from './EmptyState'
export { LoadingOverlay } from './LoadingOverlay'
export { ErrorMessage } from './ErrorMessage'
```

### 10c. Wrap the app with providers

Write `apps/mobile/src/App.tsx`:

```typescript
import { PaperProvider } from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { lightTheme } from './theme'
import { RootNavigator } from './navigation/RootNavigator'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <PaperProvider theme={lightTheme}>
          <NavigationContainer>
            <StatusBar style="auto" />
            <RootNavigator />
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  )
}
```

## Step 11: Setup Zustand and API client

Write `apps/mobile/src/store/auth.store.ts`:

```typescript
import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

interface AuthState {
  token: string | null
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
  loadToken: () => Promise<void>
}

const TOKEN_KEY = 'auth_token'

export const useAuthStore = create<AuthState>((set) => ({
  token: null,

  setToken: async (token) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    set({ token })
  },

  clearToken: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    set({ token: null })
  },

  loadToken: async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    set({ token })
  },
}))
```

Write `apps/mobile/src/lib/api.ts`:

```typescript
import { useAuthStore } from '@/store/auth.store'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token
  const { body, headers, ...rest } = options

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error?.message ?? res.statusText)
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
```

Write `apps/mobile/src/store/index.ts`:

```typescript
export { useAuthStore } from './auth.store'
// Add feature-specific stores here as features are implemented
```

## Step 12: Create the root navigator skeleton

```bash
mkdir -p apps/mobile/src/navigation
```

Write `apps/mobile/src/navigation/RootNavigator.tsx`:

```typescript
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuthStore } from '@/store'

// Screens will be added by feature implementation agents
// This is a structural placeholder only

const Stack = createNativeStackNavigator()

export function RootNavigator() {
  const token = useAuthStore((state) => state.token)

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {token ? (
        // Authenticated screens — added by feature agents
        <Stack.Screen name="Home" component={PlaceholderScreen} />
      ) : (
        // Auth screens — added by auth feature agent
        <Stack.Screen name="SignIn" component={PlaceholderScreen} />
      )}
    </Stack.Navigator>
  )
}

function PlaceholderScreen() {
  return null
}
```

## Step 13: Configure Jest for both workspaces

Write `apps/backend/jest.config.ts` (NestJS default — verify it exists after `nest new`):

```typescript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@repo/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
}
```

Write `apps/mobile/jest.config.ts`:

```typescript
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@repo/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
}
```

## Step 14: Write Makefile

Write `Makefile` at the repo root:

```makefile
.PHONY: setup dev dev-backend dev-mobile build test lint typecheck \
        migrate migrate-prod seed docker-up docker-down studio

# ── Bootstrap ─────────────────────────────────────────────────────────────────
setup:
	pnpm install
	cp -n apps/backend/.env.example apps/backend/.env || true
	cp -n apps/mobile/.env.example apps/mobile/.env || true
	make docker-up
	sleep 3
	make migrate

# ── Development ───────────────────────────────────────────────────────────────
dev:
	make docker-up
	turbo run dev --parallel

dev-backend:
	make docker-up
	cd apps/backend && pnpm dev

dev-mobile:
	cd apps/mobile && pnpm dev

# ── Database ──────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d

docker-down:
	docker compose down

migrate:
	cd apps/backend && pnpm prisma migrate dev

migrate-prod:
	cd apps/backend && pnpm prisma migrate deploy

seed:
	cd apps/backend && pnpm prisma db seed

studio:
	cd apps/backend && pnpm prisma studio

# ── Quality ────────────────────────────────────────────────────────────────────
test:
	turbo run test

lint:
	turbo run lint

typecheck:
	turbo run typecheck

# ── Build ──────────────────────────────────────────────────────────────────────
build:
	turbo run build
```

## Step 15: Update CLAUDE.md

Read the current `CLAUDE.md`, then create or update it with:

```markdown
# CLAUDE.md

**Client:** <client name from blueprint>
**Project:** <project name from blueprint>
**Stack:** React Native (Expo) + NestJS + Passport-JWT + Prisma + TypeScript

## Monorepo Structure

```
<root>/
  apps/
    backend/          — NestJS API
      src/
        auth/         — JWT auth module
        prisma/       — PrismaService + PrismaModule
      prisma/         — schema.prisma, migrations/
    mobile/           — React Native Expo app
      src/
        components/
          ui/         — Primitive components (ScreenContainer, EmptyState …)
        navigation/   — RootNavigator and feature navigators
        screens/      — Feature screen files
        store/        — Zustand stores (auth.store.ts + feature stores)
        lib/          — api.ts (fetch wrapper + auth interceptor)
        theme/        — lightTheme, darkTheme, spacing, typography
  packages/
    types/            — Shared TypeScript interfaces (@repo/types)
  docs/
    blueprint/        — Design specs, data model, feature tasks
```

## Auth Conventions

- JWT via `@nestjs/passport` + `@nestjs/jwt` (see `nestjs-auth-patterns` skill)
- All protected NestJS controllers must have `@UseGuards(AuthGuard('jwt'))` at class level
- Use `@CurrentUser()` decorator — never read `userId` from the request body
- Mobile: JWT stored in `expo-secure-store`; attached as `Authorization: Bearer <token>` via
  Axios interceptor in `apps/mobile/src/lib/api.ts`

## API Conventions

- All NestJS controllers use the `/api/` prefix (e.g. `@Controller('api/users')`)
- Validation via `class-validator` DTOs with global `ValidationPipe`
- Ownership check on all by-ID routes — scope all queries to `user.id`
- API base URL: `process.env.EXPO_PUBLIC_API_URL` (default: `http://localhost:3001`)

## State Management

- **Server state**: TanStack Query (`useQuery`, `useMutation`) — handles loading, error,
  caching, and background refetch for all API calls
- **Client / auth state**: Zustand — `apps/mobile/src/store/auth.store.ts` for JWT token;
  feature-specific stores added alongside each feature

## Styling Conventions

- React Native Paper components for interactive elements (Button, TextInput, Card …)
- `StyleSheet.create()` for custom styles — no inline style objects except computed values
- Design tokens from `apps/mobile/src/theme/` — import `spacing`, `typography`, `lightTheme`
- Primitive layout components in `apps/mobile/src/components/ui/`

## Branch Naming

Follow `.claude/skills/git-branch-naming/SKILL.md`.

## Commit Format

Follow `.claude/skills/git-commit/SKILL.md`.
```

Do not overwrite sections that already exist — add only what is missing.

## Step 16: Verify skills

```bash
ls .claude/skills/
```

Expected: `react-native-patterns`, `nestjs-patterns`, `nestjs-auth-patterns`,
`git-commit`, `git-branch-naming`

If any are missing, list them in the output report. Do not attempt to recreate them —
they come from the orchestrator submodule.

## Step 17: Initial commit

```bash
git add -A
git commit -m "chore: scaffold React Native + NestJS monorepo with design system and tooling"
```

## Step 18: Report

```
Project setup complete.

Client: <client name>
Project: <project name>
Stack: React Native (Expo) + NestJS + Passport-JWT + Prisma

Expo workflow: managed / bare (reason: <detected signal or "default")

Monorepo:
  apps/backend/         — NestJS API with Prisma + JWT auth scaffold
  apps/mobile/          — Expo app with React Navigation + React Native Paper
  packages/types/       — @repo/types (empty, populated by plan-feature)

Database:
  docker-compose.yml    — PostgreSQL 16 on port 5432
  DATABASE_URL          — postgresql://postgres:postgres@localhost:5432/app_dev

Design system:
  apps/mobile/src/theme/    — lightTheme, darkTheme, spacing, typography
  apps/mobile/src/components/ui/ — ScreenContainer, EmptyState, LoadingOverlay, ErrorMessage
  Tokens: <applied from blueprint / defaults used>

State management:
  Zustand               — auth.store.ts (JWT token in SecureStore)
  TanStack Query        — QueryClientProvider wired in App.tsx

Feature-specific dependencies installed: <list or "none">

Skills verified: <present / missing>
CLAUDE.md: updated

Next step: Run design-analyst-flow (if Figma available) or plan-feature for each
feature in dependency order:
<list from docs/blueprint/tasks.md>
```
