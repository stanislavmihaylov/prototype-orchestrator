---
name: nextauth-patterns
description: >
  NextAuth.js (Auth.js v4) configuration patterns for this project: credentials
  provider with Prisma adapter, role-based JWT session claims, and middleware
  route protection.
---

# NextAuth.js Patterns

## Auth configuration

```typescript
// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { compare } from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.passwordHash || !user.isActive) return null;

        const valid = await compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        // Update lastLoginAt
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
};
```

## Session type augmentation

```typescript
// types/next-auth.d.ts
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string;
    role: string;
  }
}
```

## Checking session in Route Handlers

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // session.user.id and session.user.role are now available
}
```

## Checking session in Server Components

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function ProtectedPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/sign-in');
  // render page
}
```

## Role guard helper

```typescript
// lib/auth-helpers.ts
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';

type Role = 'CLAIMS_PROCESSOR' | 'CLAIMS_MANAGER' | 'PATIENT' | 'HEALTHCARE_PROVIDER' | 'SYSTEM_ADMIN';

export async function requireRole(...roles: Role[]): Promise<
  { session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>; error: null } |
  { session: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!roles.includes(session.user.role as Role)) {
    return { session: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session, error: null };
}
```

Usage:

```typescript
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('CLAIMS_MANAGER', 'SYSTEM_ADMIN');
  if (error) return error;
  // proceed with session.user.id and session.user.role
}
```

## Sign-in page (Client Component)

```typescript
'use client';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = await signIn('credentials', {
      email: form.get('email'),
      password: form.get('password'),
      redirect: false,
    });
    if (result?.error) {
      setError('Invalid email or password');
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      <button type="submit">Sign In</button>
    </form>
  );
}
```

## Session provider (root layout)

```typescript
// app/layout.tsx
import { SessionProvider } from 'next-auth/react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html>
      <body>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
```

## Anti-patterns

- Never read `session.user.role` on the client without server-side validation — the client session is derived from the JWT but the authoritative check must happen in the Route Handler or middleware.
- Never skip `isActive` check in the `authorize` callback — a deactivated user must not be able to sign in.
- Never store passwords in plaintext — always use `bcryptjs` hash with salt rounds >= 12.
- Do not use the `database` session strategy for the prototype — JWT strategy avoids extra DB round-trips.
