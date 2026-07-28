# AGENTS.md — Base BaaS

> **For AI agents reading this:** This file is your orientation guide. Read it first before touching any code.

## What Is This Project?

**Base** is a minimalistic, self-hosted Backend-as-a-Service (BaaS). It provides schema-driven REST CRUD, authentication, file uploads, and database replication — all in a single Bun process. It's an alternative to Supabase, PocketBase, and Convex.

**One-sentence summary:** Define TypeScript collections → get typed REST API + validation + auth + files + SQLite automatically.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Bun** | Fast startup, native TS, built-in APIs |
| HTTP | **Hono** | Ultra-lightweight (14KB), type-safe routing |
| Database | **libSQL / SQLite** (`@libsql/client`) | Embedded (`file:`) or remote (`libsql://` Turso) — same code |
| ORM | **Drizzle ORM** (`drizzle-orm/libsql`) | Type-safe queries, migration tooling |
| Auth | **Better Auth** | Email/password, sessions, OAuth-ready, plugin ecosystem |
| Validation | **Zod** | Auto-generated from schema definitions |
| IDs | **ULID** (`ulid`) | Lexicographically sortable, URL-safe |
| Replication | **Litestream** (optional sidecar) | WAL streaming to S3/R2/B2 |

## Project Structure

```
base/
├── collections.ts              ← USER EDITS: define collections here
├── src/
│   ├── index.ts                Entry point — starts server
│   ├── index-public.ts         Public API exports (for SDK usage)
│   ├── env.ts                  Zod-validated environment variables
│   ├── config.ts               Paths + feature flags + dir creation
│   │
│   ├── schema/                 SCHEMA ENGINE
│   │   ├── types.ts            FieldSchema, CollectionSchema, IndexSchema types
│   │   ├── define.ts           Field builder `f.string().required()` + `defineCollection()`
│   │   ├── registry.ts         Collection storage + validation (duplicate names, ref integrity)
│   │   ├── to-drizzle.ts       Schema → Drizzle column definitions
│   │   ├── to-zod.ts           Schema → Zod create/update validators
│   │   └── index-registry.ts   Runtime registry read by server on startup
│   │
│   ├── db/
│   │   ├── client.ts           libSQL + Drizzle singleton (`export const db`)
│   │   ├── schema.ts           Better Auth tables (user, session, account, verification)
│   │   └── migrate.ts          Auto-create Better Auth tables on boot
│   │
│   ├── auth/
│   │   ├── auth.ts             Better Auth instance (Drizzle adapter, SQLite)
│   │   ├── handler.ts          Passes raw Request to Better Auth handler
│   │   └── middleware.ts       `requireAuth` + `optionalAuth` Hono middleware
│   │
│   ├── collections/
│   │   ├── table-create.ts     CREATE TABLE IF NOT EXISTS from CollectionSchema
│   │   ├── crud.ts             Generic create/getById/update/remove (raw SQL via libSQL)
│   │   ├── query.ts            List with filter/sort/pagination + meta response
│   │   └── router.ts           Auto-generates Hono CRUD routes per collection
│   │
│   ├── files/
│   │   ├── meta.ts             `files` table CRUD (metadata)
│   │   ├── storage.ts          Local disk read/write/delete (ULID filenames)
│   │   └── router.ts           Upload/download/list/delete routes
│   │
│   └── server/
│       ├── hono-app.ts         App assembly: CORS + error handler + route mounting
│       ├── error-handler.ts    ZodError→400, generic→500
│       └── cors.ts             CORS from env
│
├── drizzle.config.ts           drizzle-kit config (libSQL)
├── litestream.yml              Litestream replication config (optional)
├── Dockerfile                  Single-container deploy
├── docker-compose.yml          App + MinIO (S3 testing)
└── package.json                @base/core
```

## Architecture: Request Flow

```
Client Request
    │
    ▼
Hono App (hono-app.ts)
    │
    ├── CORS middleware ──────────────────────► all routes
    ├── Error handler (onError) ─────────────► all routes
    │
    ├── /api/health ─────────────────────────► static JSON
    ├── /api/auth/me ─────────────────────────► requireAuth middleware → user JSON
    ├── /api/auth/* ──────────────────────────► Better Auth handler (sign-up, sign-in, etc.)
    ├── /api/collections/:name/* ─────────────► CollectionRouter (requireAuth + Zod + CRUD)
    └── /api/files/* ─────────────────────────► FilesRouter (requireAuth + upload/download)
```

## Key Design Patterns

### 1. Schema → Everything (single source of truth)

User writes `collections.ts`:
```typescript
const posts = defineCollection('posts', {
  fields: { title: f.string().required().max(200), ... },
  indexes: [{ fields: ['slug'], unique: true }],
})
register(posts)
```

This single definition generates:
- **SQL table** (`table-create.ts` → `CREATE TABLE IF NOT EXISTS`)
- **Zod validators** (`to-zod.ts` → create strict + update partial)
- **REST routes** (`router.ts` → GET/POST/PATCH/DELETE)
- **Auto defaults** (published→false, viewCount→0, timestamps)

### 2. Dynamic Tables (not Drizzle schema objects)

Collection tables are **NOT** defined in `src/db/schema.ts`. Only Better Auth's 4 tables are there. User collections are created at runtime via raw SQL in `table-create.ts`. This allows tables to be defined in `collections.ts` without code generation steps.

**CRUD operations** (`crud.ts`, `query.ts`) use raw SQL via `@libsql/client` directly (not Drizzle's query builder) because the table structure is dynamic and Drizzle needs compile-time table definitions.

**Better Auth** uses Drizzle properly (4 static tables in `schema.ts`).

### 3. Registry Pattern

```
collections.ts (user file)
    │ imports defineCollection()
    ▼
define.ts → defineCollection()
    │ calls registerCollection()
    ▼
registry.ts → Map<string, CollectionSchema>
    │ read by index-registry.ts
    ▼
hono-app.ts → getRegisteredCollections()
    │ iterates and mounts routers
    ▼
CollectionRouter per collection
```

**Critical:** `collections.ts` is imported in `index.ts` **before** `hono-app.ts` so the registry is populated before route mounting.

### 4. Auto-Migration on Boot

`migrate.ts` runs on startup — creates Better Auth's 4 tables if they don't exist. Collection tables are created lazily on first access (`ensureCollectionTable()` with a `Set` cache).

## Database

- **Local dev:** `DATABASE_URL=file:./data/app.db` (embedded SQLite file)
- **Production:** `DATABASE_URL=libsql://<db>.turso.io` + `DATABASE_AUTH_TOKEN=...` (Turso managed)
- **WAL mode** enabled for local file mode
- **Same code** works for both — no changes needed

**Better Auth tables** (in `schema.ts`): `user`, `session`, `account`, `verification`
**Collection tables** (dynamic): created from `collections.ts` definitions
**Files table** (in `meta.ts`): created lazily on first file upload

## Adding a New Collection

1. Edit `collections.ts`
2. Define fields with `f.string().required().max(200)` syntax
3. Call `register(collection)`
4. Restart server — table auto-created, routes auto-mounted

No migration files, no codegen. Just define and restart.

## Common Tasks for AI Agents

### "Add a new field type"

1. Add type to `FieldType` union in `src/schema/types.ts`
2. Add builder method to `f` object in `src/schema/define.ts`
3. Add column mapping in `buildColumnDef()` in `src/collections/table-create.ts`
4. Add Zod mapping in `buildZodField()` in `src/schema/to-zod.ts`
5. Add deserialization in `crud.ts` and `query.ts` (`deserializeRow`)

### "Add a new API route"

1. Add to `hono-app.ts` for top-level routes (`/api/something`)
2. Or add to `router.ts` for collection-specific routes
3. Always apply `requireAuth` middleware on protected routes
4. Use `c.get('user' as never) as any` to access the authenticated user

### "Debug auth issues"

1. Check `src/auth/auth.ts` — Better Auth config
2. Check `src/db/schema.ts` — tables must exist (auto-migrated on boot)
3. Check `src/db/migrate.ts` — runs `CREATE TABLE IF NOT EXISTS` on startup
4. Sessions use cookies: `better-auth.session_token`
5. Test: `curl -X POST /api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"x@y.com","password":"pass123","name":"Test"}'`

### "Change validation rules"

Edit `src/schema/to-zod.ts`:
- `schemaToZod()` builds create + update validators
- System fields (id, createdAt, updatedAt, deletedAt) are excluded from validators
- Create schema is `.strict()` (rejects unknown fields)
- Update schema is all-optional (partial)

## Development Commands

```bash
bun run dev          # Start dev server with watch mode
bun run start        # Start production server
bun run test         # Run tests (bun:test)
bun run typecheck    # TypeScript check (tsc --noEmit)
bun run db:generate  # Generate Drizzle migration files
bun run db:migrate   # Run Drizzle migrations
```

## Testing the API

```bash
# Health
curl http://localhost:3000/api/health

# Sign up
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","name":"Test"}'

# Sign in (saves cookie)
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}' \
  -c cookies.txt

# Create record
curl -X POST http://localhost:3000/api/collections/posts \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"Hello","slug":"hello","authorId":"user-1"}'

# List with pagination
curl "http://localhost:3000/api/collections/posts?page=1&perPage=10&sort=-createdAt" \
  -b cookies.txt

# Upload file
curl -X POST http://localhost:3000/api/files \
  -F "file=@photo.jpg" \
  -b cookies.txt
```

## Conventions

- **ESM only** — all imports use `.js` extensions (bundler resolution)
- **No `require()`** — use `import`
- **TypeScript strict mode** — `bunx tsc --noEmit` must pass
- **Error format:** `{ error: { code: "ERROR_CODE", message: "Human readable" } }`
- **Success format:** `{ data: ... }` or `{ data: [...], meta: { page, perPage, total, totalPages } }`
- **IDs:** ULID (lexicographically sortable)
- **Timestamps:** Unix milliseconds (integer), auto-managed
- **Soft delete:** `deletedAt` column, filtered in queries by default
- **Auth required** by default on all collection + file routes

## What's NOT Here (Future)

- Realtime/subscriptions (SSE) — not implemented
- Vector search — `f.vector()` type exists but no search endpoint yet
- SDK generator — planned but not built
- Admin dashboard — not built
- Versioned migrations — auto-migrate on boot only (fine for early stage)
