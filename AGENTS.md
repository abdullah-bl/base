# AGENTS.md — Base BaaS

> **For AI agents reading this:** This file is your orientation guide. Read it first before touching any code.

## What Is This Project?

**Base** is a minimalistic, self-hosted Backend-as-a-Service (BaaS). It provides schema-driven REST CRUD, authentication, file uploads, access rules, additive schema evolution, realtime SSE subscriptions, an admin control plane, backup/restore, a standalone CLI, and a generated TypeScript client — all in a single Bun process. It's an alternative to Supabase, PocketBase, and Convex focused on minimal overhead.

**One-sentence summary:** Define TypeScript collections → get typed REST API + validation + auth + ownership rules + files + realtime + admin + SQLite automatically.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Bun** | Fast startup, native TS, built-in APIs (+ native S3Client) |
| HTTP | **Hono** | Ultra-lightweight, type-safe routing |
| Database | **libSQL / SQLite** (`@libsql/client`) | Embedded (`file:`) or remote (`libsql://` Turso) — same code |
| ORM | **Drizzle ORM** (`drizzle-orm/libsql`) | Better Auth adapter + optional kit tooling |
| Auth | **Better Auth** | Email/password, sessions, roles, API keys |
| Validation | **Zod** | Auto-generated from schema definitions |
| IDs | **ULID** (`ulid`) | Lexicographically sortable, URL-safe |
| Admin UI | **React + Vite + Tailwind** | Built to `src/admin/dist`, served at `/_` |
| Replication | **Litestream** (optional sidecar) | WAL streaming to S3/R2/B2 |

## Project Structure

```
base/
├── collections.ts              ← USER EDITS: define collections here
├── admin/                      React admin UI source (Vite)
├── scripts/
│   ├── schema.ts               Schema evolution CLI (status/apply)
│   ├── generate-client.ts      Typed client generator
│   └── build-binaries.ts       Cross-compile base CLI
├── src/
│   ├── index.ts                Entry point
│   ├── cli/index.ts            Standalone `base` CLI
│   ├── server/bootstrap.ts     Injectable boot (server + CLI)
│   ├── admin/                  Admin API + static SPA serving
│   ├── observability/          Structured logs, audit, request IDs
│   ├── backup/                 VACUUM INTO / JSONL backup+restore
│   ├── openapi/                OpenAPI generator from registry
│   ├── webhooks/               Outbound change delivery
│   ├── auth/                   Better Auth + API keys + middleware
│   ├── collections/            CRUD / query / access / router
│   ├── realtime/               SSE pub/sub
│   ├── files/                  Storage drivers + routes
│   └── server/                 Hono app, CORS, rate limit, errors
├── tests/
└── package.json
```

## Architecture: Request Flow

```
Client Request
    │
    ▼
Hono App (createApp)
    │
    ├── requestId + HTTP log middleware
    ├── CORS middleware
    ├── Rate limit middleware
    ├── Error handler (requestId in payload)
    │
    ├── /api/health|/live|/ready
    ├── /api/openapi.json
    ├── /api/auth/me          → requireAuth (session or API key)
    ├── /api/auth/*           → Better Auth
    ├── /api/collections/*    → access rules + Zod + CRUD → publishChange → audit/webhooks
    ├── /api/realtime         → SSE (filtered by canReadRecord)
    ├── /api/files/*          → owner-only upload/download (local | s3)
    ├── /api/admin/*          → requireAdmin (role=admin or X-Admin-Token)
    └── /_/*                  → Admin SPA (when ADMIN_ENABLED)
```

## Key Design Patterns

### 1. Schema → Everything

```typescript
const posts = defineCollection('posts', {
  fields: { title: f.string().required().max(200), authorId: f.reference('user').required() },
  access: { create: 'owner', read: 'owner', update: 'owner', delete: 'owner', ownerField: 'authorId' },
})
```

Generates: SQL table, Zod validators, REST routes, ownership filters, typed client methods + subscribe, OpenAPI paths.

### 2. Admin identity

- `user.role` is `user` | `admin` (Better Auth `additionalFields`, `input: false`)
- First registered user (or emails in `ADMIN_EMAILS`) is promoted to admin
- Break-glass: `X-Admin-Token: $ADMIN_TOKEN` (min 32 chars)

### 3. Query operators

Filters support `field__op` / JSON `{op,value}`: `eq|ne|gt|gte|lt|lte|like|in|null|nnull`, plus `?search=` LIKE across string/text fields.

### 4. Additive Schema Evolution

`src/schema/evolve.ts` diffs registered schemas vs stored fingerprints. Destructive changes fail with a report. CLI: `bun run schema:status` / `schema:apply` or `base schema status|apply`.

### 5. Realtime + webhooks

`publishChange()` fans out SSE and optional outbound webhooks. Single-process SSE only.

## Development Commands

```bash
bun run dev              # Start with watch
bun run start            # Production server
bun run test             # bun test --concurrency=1
bun run typecheck        # tsc --noEmit
bun run check            # typecheck + test
bun run build:admin      # Build admin SPA → src/admin/dist
bun run schema:status    # Dry-run schema plan
bun run schema:apply     # Apply additive migrations
bun run generate:client  # Emit src/client/generated.ts
bun run cli -- help      # Standalone CLI
bun run build:binary     # Compile single-file executable
```

## Conventions

- **ESM only** — imports use `.js` extensions
- **TypeScript strict** — `bun run typecheck` must pass
- **Error format:** `{ error: { code, message, requestId? } }`
- **Success format:** `{ data }` or `{ data, meta }`
- **IDs:** ULID; **timestamps:** Unix ms
- **Soft delete** by default; hard delete requires `HARD_DELETE_ENABLED=true`
- **Auth required** by default; use `access` for ownership / public reads
- **Better Auth user table** is `user` (singular) — use `f.reference('user')`
- **Admin UI** builds to `src/admin/dist` (gitignored); placeholder served if missing

## What's NOT Here (Deferred)

- Vector search endpoint (`f.vector()` stores only) — libSQL/Turso extension parity unresolved
- GraphQL / functions / workflows
- Cross-process realtime (multi-instance fan-out)
- Expand/relations, batch transactions, email hooks, OAuth providers
