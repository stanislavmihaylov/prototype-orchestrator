---
name: nestjs-patterns
description: >
  NestJS patterns for this project: module structure, dependency injection, guards,
  DTOs with class-validator, error handling, Prisma integration, and response
  serialization. Use when implementing backend features.
---

# NestJS Patterns

## Module structure — one module per domain

Each feature domain gets its own NestJS module. Register it in `AppModule`.

```typescript
// apps/backend/src/journal/journal.module.ts
import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService], // export if other modules need this service
})
export class JournalModule {}
```

```typescript
// apps/backend/src/app.module.ts — register here
import { JournalModule } from './journal/journal.module';

@Module({
  imports: [
    // ...
    JournalModule,
  ],
})
export class AppModule {}
```

## Dependency injection — never use `new` for services

```typescript
// CORRECT — inject via constructor
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}
}

// WRONG — manual instantiation
const prisma = new PrismaService(); // never do this
```

## Guards — every protected route needs @UseGuards

Apply `@UseGuards(AuthGuard('jwt'))` at the controller class level to protect all routes:

```typescript
@Controller('api/journal')
@UseGuards(AuthGuard('jwt'))  // protects ALL routes in this controller
export class JournalController {
  @Get()
  findAll(@Req() req: any) {
    return this.journalService.findAllByUser(req.user.sub);
  }
}
```

For public endpoints, use a `@Public()` decorator + a modified JWT strategy that skips validation when `@Public()` is present:

```typescript
// apps/backend/src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

The JWT strategy checks for `IS_PUBLIC_KEY` and allows the request through without a token.

## Extracting the authenticated user

Always use `req.user.sub` for the Auth0 subject — never trust a userId from the request body.

```typescript
@Post()
async create(@Req() req: any, @Body() dto: CreateJournalEntryDto) {
  return this.journalService.createEntry(req.user.sub, dto);
}
```

For better typing, create a custom decorator:

```typescript
// apps/backend/src/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// Usage:
@Post()
async create(@CurrentUser() user: { sub: string }, @Body() dto: CreateJournalEntryDto) {
  return this.journalService.createEntry(user.sub, dto);
}
```

## Auth0 ID vs internal user ID — CRITICAL distinction

`req.user.sub` is the Auth0 subject (e.g. `auth0|abc123`). The `users` table stores this in `auth0Id`. The `users.id` column is a separate CUID used as a foreign key in all other tables (`journalEntry.userId`, `userJourneyProgress.userId`, etc.).

**Never pass `req.user.sub` directly as a FK `userId`.** Always resolve it first:

```typescript
// CORRECT — resolve auth0Id → internal users.id before any FK write/read
@Injectable()
export class SomeFeatureService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveUserId(auth0Id: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { auth0Id } });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }

  async doSomething(auth0Id: string, dto: SomeDto) {
    const userId = await this.resolveUserId(auth0Id); // internal CUID
    return this.prisma.someModel.create({ data: { userId, ...dto } });
  }
}
```

```typescript
// WRONG — auth0Id used directly as FK; causes FK constraint violation at runtime
async doSomething(auth0Id: string, dto: SomeDto) {
  return this.prisma.someModel.create({ data: { userId: auth0Id, ...dto } });
}
```

The controller passes `req.user.sub`; the service resolves it. Mocked tests never hit this because PrismaService is mocked — the FK constraint is only enforced by a real PostgreSQL database.

## DTOs — class-validator on every field

```typescript
// apps/backend/src/journal/dto/create-journal-entry.dto.ts
import { IsString, IsOptional, MaxLength, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateJournalEntryDto {
  @IsString()
  @MaxLength(10000)  // always set MaxLength — no unbounded inputs
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  mood?: string;

  @IsDateString()
  @IsOptional()
  entryDate?: string; // ISO 8601 string — convert to Date in service
}
```

Apply `ValidationPipe` globally in `main.ts`:

```typescript
// apps/backend/src/main.ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,           // strips properties not in DTO
    forbidNonWhitelisted: true, // throws if extra properties present
    transform: true,           // auto-transform types
  }),
);
```

## Error handling — throw NestJS exceptions from services

```typescript
// CORRECT — throw HttpException subclasses from services
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';

@Injectable()
export class JournalService {
  async findEntryById(id: string, userId: string): Promise<JournalEntryResponseDto> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId }, // ownership check included in query
    });

    if (!entry) {
      throw new NotFoundException('Journal entry not found');
      // 404 preferred over 403 — avoids leaking existence of other users' entries
    }

    return new JournalEntryResponseDto(entry);
  }
}
```

Common exceptions to use:
- `NotFoundException` → 404 (missing or not owned)
- `ForbiddenException` → 403 (authenticated but not authorized for an operation)
- `ConflictException` → 409 (duplicate resource)
- `BadRequestException` → 400 (business rule violation beyond DTO validation)
- `UnauthorizedException` → 401 (unauthenticated — usually handled by AuthGuard automatically)

## Prisma — always inject PrismaService, always include userId in queries

```typescript
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(userId: string): Promise<JournalEntryResponseDto[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { userId },                // always scope to user
      orderBy: { createdAt: 'desc' },
    });
    return entries.map((e) => new JournalEntryResponseDto(e));
  }
}
```

For multi-step writes, use `prisma.$transaction`:

```typescript
async createEntryWithTag(userId: string, dto: CreateEntryWithTagDto) {
  return this.prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: { content: dto.content, userId },
    });
    await tx.entryTag.create({
      data: { entryId: entry.id, tag: dto.tag },
    });
    return new JournalEntryResponseDto(entry);
  });
}
```

## Response serialization — exclude sensitive fields

```typescript
// apps/backend/src/journal/dto/journal-entry-response.dto.ts
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class JournalEntryResponseDto {
  @Expose() id: string;
  @Expose() userId: string;
  @Expose() content: string;
  @Expose() mood: string | null;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;
  // Fields without @Expose() are excluded from the serialized output

  constructor(partial: Partial<JournalEntryResponseDto>) {
    Object.assign(this, partial);
  }
}
```

Apply `ClassSerializerInterceptor` globally in `main.ts`:

```typescript
import { ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
```

## HTTP status codes

| Scenario | Code | NestJS |
|---|---|---|
| Successful creation | 201 | `@HttpCode(201)` on POST (or use `@Post()` default) |
| Successful read/update | 200 | Default |
| Missing or not owned resource | 404 | `throw new NotFoundException()` |
| Validation error | 400 | Automatic via `ValidationPipe` |
| Authentication missing | 401 | Automatic via `AuthGuard` |
| Authenticated but not authorized | 403 | `throw new ForbiddenException()` |
| Duplicate resource | 409 | `throw new ConflictException()` |
