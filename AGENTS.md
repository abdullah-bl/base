# AGENTS.md — Base BaaS

> **For AI agents reading this:** This file is your orientation guide. Read it first before touching any code.

## What Is This Project?

**Base** is a minimalistic, self-hosted Backend-as-a-Service (BaaS). It provides schema-driven REST CRUD, authentication, file uploads, access rules, additive schema evolution, and a generated TypeScript client — all in a single Bun process. It's an alternative to Supabase, PocketBase, and Convex focused on minimal overhead.

**One-sentence summary:** Define TypeScript collections → get typed REST API + validation + auth + ownership rules + files + SQLite automatically.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Bun** | Fast startup, native TS, built-in APIs |
| HTTP | **Hono** | Ultra-lightweight, type-safe routing |
| Database | **libSQL / SQLite** (`@libsql/client`) | Embedded (`file:`) or remote (`libsql://` Turso) — same code |
| ORM | **Drizzle ORM** (`drizzle-orm/libsql`) | Better Auth adapter + optional kit tooling |
| Auth | **Better Auth** | Email/password, sessions, OAuth-ready |
| Validation | **Zod** | Auto-generated from schema definitions |
| IDs | **ULID** (`ulid`) | Lexicographically sortable, URL-safe |
| Replication | **Litestream** (optional sidecar) | WAL streaming to S3/R2/B2 |

## Project Structure

```
base/
├── collections.ts              ← USER EDITS: define collections here
├── scripts/
│   ├── schema.ts               Schema evolution CLI (status/apply)
│   └── generate-client.ts      Typed client generator
├── src/
│   ├── index.ts                Entry point — Bun.serve
│   ├── index-public.ts         Public API exports
│   ├── env.ts                  Zod-validated env (prod-hardened)
│   ├── config.ts               Paths + feature flags
│   ├── client/generated.ts     Generated BaseClient (build-time)
│   ├── schema/                 SCHEMA ENGINE
│   │   ├── types.ts            Field/Collection/Access types
│   │   ├── define.ts           f.* builders + defineCollection()
│   │   ├── registry.ts         Single registry + validateRegistry()
│   │   ├── to-zod.ts           Schema → Zod validators
│   │   ├── to-drizzle.ts       Schema → Drizzle (optional/legacy)
│   │   └── evolve.ts           Additive schema evolution
│   ├── db/
│   │   ├── client.ts           Shared libSQL client + Drizzle
│   │   ├── schema.ts           Better Auth tables
│   │   └── migrate.ts          Auth + metadata tables on boot
│   ├── auth/                   Better Auth + middleware
│   ├── collections/
│   │   ├── table-create.ts     CREATE TABLE IF NOT EXISTS
│   │   ├── serialize.ts        Shared serialize/deserialize
│   │   ├── access.ts           RLS-lite access helpers
│   │   ├── crud.ts             create/get/update/remove
│   │   ├── query.ts            list + filter/sort/pagination
│   │   └── router.ts           Hono CRUD routes
│   ├── files/                  Upload/download with ownership
│   └── server/                 CORS, errors, createApp()
├── tests/                      Unit + integration tests
└── package.json
```

## Architecture: Request Flow

```
Client Request
    │
    ▼
Hono App (createApp)
    │
    ├── CORS middleware
    ├── Error handler (generic 500s in production)
    │
    ├── /api/health
    ├── /api/auth/me          → requireAuth
    ├── /api/auth/*           → Better Auth
    ├── /api/collections/*    → access rules + Zod + CRUD
    └── /api/files/*          → owner-only upload/download
```

## Key Design Patterns

### 1. Schema → Everything

```typescript
const posts = defineCollection('posts', {
  fields: { title: f.string().required().max(200), authorId: f.reference('user').required() },
  access: { create: 'owner', read: 'owner', update: 'owner', delete: 'owner', ownerField: 'authorId' },
})
```

Generates: SQL table, Zod validators, REST routes, ownership filters, typed client methods.

### 2. Single Registry

`defineCollection()` registers into `registry.ts`. Server mounts from `getRegisteredCollections()`. Startup calls `validateRegistry()`.

### 3. Shared DB Client

One libSQL client from `src/db/client.ts` (`getClient()` / `initDb()`). Collections, files, and migrations all reuse it. WAL pragmas are awaited before boot continues.

### 4. Access Rules (RLS-lite)

Per-collection `access` with levels `public` | `authenticated` | `owner`. Owner constraints are applied in SQL (list/get) and checked on mutate. Owner fields are server-set on create.

### 5. Additive Schema Evolution

`src/schema/evolve.ts` diffs registered schemas vs stored fingerprints. Supports new nullable/defaulted columns and indexes. Destructive changes fail with a report. CLI: `bun run schema:status` / `schema:apply`.

## Development Commands

```bash
bun run dev              # Start with watch
bun run start            # Production server
bun run test             # bun test --concurrency=1
bun run typecheck        # tsc --noEmit
bun run check            # typecheck + test
bun run schema:status    # Dry-run schema plan
bun run schema:apply     # Apply additive migrations
bun run generate:client  # Emit src/client/generated.ts
```

## Conventions

- **ESM only** — imports use `.js` extensions
- **TypeScript strict** — `bun run typecheck` must pass
- **Error format:** `{ error: { code, message } }`
- **Success format:** `{ data }` or `{ data, meta }`
- **IDs:** ULID; **timestamps:** Unix ms
- **Soft delete** by default; hard delete requires `HARD_DELETE_ENABLED=true`
- **Auth required** by default; use `access` for ownership / public reads
- **Better Auth user table** is `user` (singular) — use `f.reference('user')`

## What's NOT Here (Deferred)

- Realtime/subscriptions (SSE) — next after access rules
- S3 storage adapter
- Vector search endpoint (`f.vector()` stores only)
- Admin dashboard
- GraphQL / workflows
