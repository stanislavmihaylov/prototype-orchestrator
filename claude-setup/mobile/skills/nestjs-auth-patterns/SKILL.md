---
name: nestjs-auth-patterns
description: >
  Self-contained JWT authentication for NestJS using @nestjs/passport + @nestjs/jwt.
  Covers AuthModule setup, LocalStrategy (email/password login), JwtStrategy (route
  protection), the @CurrentUser() decorator, and the login endpoint pattern.
  Use when implementing auth or adding protected endpoints.
---

# NestJS Auth Patterns — Passport-JWT

Authentication is self-contained: no external auth provider. Credentials are stored
in the database (bcrypt-hashed password). JWTs are signed and verified by the backend.

## Dependencies

```bash
pnpm add @nestjs/passport @nestjs/jwt passport passport-local passport-jwt bcrypt
pnpm add -D @types/passport-local @types/passport-jwt @types/bcrypt
```

## Module setup

```typescript
// apps/backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
})
export class AuthModule {}
```

## LocalStrategy — validates email + password at login

```typescript
// apps/backend/src/auth/strategies/local.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' }); // tell passport the field name
  }

  async validate(email: string, password: string) {
    const user = await this.authService.validateUser(email, password);
    if (!user) throw new UnauthorizedException();
    return user; // attached to req.user by passport
  }
}
```

## JwtStrategy — validates Bearer token on protected routes

```typescript
// apps/backend/src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    return { id: payload.sub, email: payload.email }; // becomes req.user
  }
}
```

## AuthService — user validation and token signing

```typescript
// apps/backend/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return null;
    const { passwordHash, ...result } = user;
    return result;
  }

  login(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email };
    return { accessToken: this.jwtService.sign(payload) };
  }

  async register(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create({ email, passwordHash });
    return this.login(user);
  }
}
```

## AuthController — login and register endpoints

```typescript
// apps/backend/src/auth/auth.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { Public } from './decorators/public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  login(@Req() req: any) {
    return this.authService.login(req.user);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }
}
```

## @CurrentUser() decorator — typed access to the authenticated user

```typescript
// apps/backend/src/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as { id: string; email: string };
  },
);

// Usage in any protected controller:
@Get('profile')
getProfile(@CurrentUser() user: { id: string; email: string }) {
  return user;
}
```

## Protecting routes

Apply `@UseGuards(AuthGuard('jwt'))` at controller class level to protect all routes:

```typescript
@Controller('api/journal')
@UseGuards(AuthGuard('jwt'))  // all routes in this controller are protected
export class JournalController {
  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.journalService.findAllByUser(user.id);
  }
}
```

For public endpoints, use the `@Public()` decorator (see `nestjs-patterns` skill) — this signals the JWT guard to skip validation for that route.

## JWT payload shape

The JWT payload is `{ sub: userId, email: string }` where `sub` is the internal database `users.id` (a CUID). After `JwtStrategy.validate()` runs, `req.user` is `{ id: string; email: string }`.

**Always use `user.id` (not `user.sub`) when accessing the authenticated user in controllers** — the strategy already maps `sub` → `id` in the validate return.

## Environment variable

```
JWT_SECRET=<random 32+ character string>
```

Add to `.env.example`. Never commit the actual value.
