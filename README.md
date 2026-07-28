# Base

A minimalistic, self-hosted Backend-as-a-Service. SQLite + Drizzle + Better Auth + file uploads. An alternative to Supabase, PocketBase, and Convex — with a code-first TypeScript schema and minimal overhead.

```bash
bun run src/index.ts  # running on :3000
```

## Features

- **Schema-to-API** — Define collections in TypeScript, get REST CRUD + validation automatically
- **Auth** — Email/password, sessions, OAuth-ready (Better Auth)
- **Access rules** — Compact owner / authenticated / public policies per collection
- **Realtime** — SSE collection-change subscriptions, filtered by access rules
- **Files** — Upload, download, delete with ownership tracking (local disk or S3)
- **SQLite** — libSQL/SQLite embedded, zero-config (Turso-ready)
- **Schema evolution** — Additive column/index migrations with dry-run CLI
- **Typed client** — Generate a TypeScript client from your collections (incl. `.subscribe()`)
- **Replication** — Litestream sidecar for disaster recovery (optional)
- **Lightweight** — Single Bun process

## Quick Start

```bash
# Install
bun install

# Configure (optional for local dev — secret is auto-generated with a warning)
cp .env.example .env

# Start dev server
bun run dev

# Verify
bun run check

# Server runs at http://localhost:3000
```

## Define Collections

Edit `collections.ts`:

```typescript
import { defineCollection, f } from './src/schema/define.js'

const posts = defineCollection('posts', {
  fields: {
    title: f.string().required().max(200),
    content: f.text().optional(),
    slug: f.string().unique(),
    published: f.boolean().default(false),
    viewCount: f.integer().default(0),
    authorId: f.reference('user').required(),
  },
  indexes: [
    { fields: ['authorId', 'createdAt'], name: 'idx_posts_author' },
    { fields: ['slug'], unique: true },
  ],
  access: {
    create: 'owner',
    read: 'owner',
    update: 'owner',
    delete: 'owner',
    ownerField: 'authorId',
  },
})
```

`defineCollection` registers the collection automatically. Tables are created / evolved on server start. Routes are auto-mounted.

## API

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-up/email` | Register `{ email, password, name }` |
| POST | `/api/auth/sign-in/email` | Login `{ email, password }` |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/auth/get-session` | Current session (Better Auth) |
| GET | `/api/auth/me` | Current user (auth required) |

### Collections (auto-generated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/collections/:name` | List — `?filter={"x":"y"}&sort=-createdAt&page=1&perPage=20` (also `filter[x]=y`) |
| GET | `/api/collections/:name/:id` | Get by ID |
| POST | `/api/collections/:name` | Create |
| PATCH | `/api/collections/:name/:id` | Update (partial) |
| DELETE | `/api/collections/:name/:id` | Soft delete (`?hard=true` only if `HARD_DELETE_ENABLED=true`) |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files` | Upload (multipart, `file` field) |
| GET | `/api/files/:id` | Download (owner only) |
| GET | `/api/files` | List user's files |
| DELETE | `/api/files/:id` | Delete (owner only) |

### Realtime (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/realtime?collections=posts,comments` | SSE stream of create/update/delete events |

Events are filtered by each collection's **read** access policy (same rules as `GET`). Anonymous clients may only subscribe to `read: 'public'` collections. Heartbeats every 15s; reconnect with `Last-Event-ID` to replay from the in-process ring buffer.

```typescript
const sub = client.posts.subscribe((event) => {
  console.log(event.action, event.record)
})
// later:
sub.close()
```

Or multiplex: `client.subscribeMany(['posts', 'comments'], handler)`.

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | `{ status: "ok", timestamp, version, uptime }` |

## Field Types

| Builder | TypeScript | Example |
|---------|-----------|---------|
| `f.string()` | string | `f.string().required().max(200)` |
| `f.text()` | string | `f.text().optional()` |
| `f.integer()` | number | `f.integer().default(0)` |
| `f.real()` | number | `f.real().optional()` |
| `f.boolean()` | boolean | `f.boolean().default(false)` |
| `f.date()` | Date | `f.date().optional()` |
| `f.json()` | object | `f.json().optional()` |
| `f.reference('table')` | string | `f.reference('user').required()` |
| `f.vector(1536)` | number[] | `f.vector(1536).optional()` *(search endpoint planned)* |

Modifiers: `.required()`, `.optional()`, `.default(val)`, `.unique()`, `.max(n)`, `.min(n)`

## Access Rules

```typescript
access: {
  create: 'owner',        // 'public' | 'authenticated' | 'owner'
  read: 'authenticated',
  update: 'owner',
  delete: 'owner',
  ownerField: 'authorId', // required when any rule is 'owner'
}
```

Default (no `access` block): all operations require authentication (no row ownership filter). In production, collections without an explicit policy log a warning.

## Typed Client

```bash
bun run generate:client
```

```typescript
import { BaseClient } from '@base/core/client'

const client = new BaseClient({ baseUrl: 'http://localhost:3000' })
await client.signIn({ email: 'a@b.com', password: 'password123' })
const { data, meta } = await client.posts.list({ sort: '-createdAt' })

const sub = client.posts.subscribe((event) => {
  // event.action: 'create' | 'update' | 'delete'
  console.log(event.record)
})
```

`subscribe` uses `fetch` + `ReadableStream` (not `EventSource`) so Cookie / Authorization headers work.

## Storage Drivers

| Driver | When | Config |
|--------|------|--------|
| `local` (default) | Single-node / local disk | `STORAGE_PATH` |
| `s3` | Ephemeral disks, multi-instance, object storage | `S3_BUCKET` + credentials |

```bash
# Local MinIO (docker compose --profile storage up)
STORAGE_DRIVER=s3
S3_BUCKET=base-uploads
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
# FILES_DOWNLOAD_MODE=redirect   # optional: 302 to presigned URL (recommended in production)
```

`storageKey` in the DB stays a flat ULID; `S3_PREFIX` is applied only inside the driver.

## Schema Evolution

Additive-only (new nullable/defaulted columns + indexes). Destructive changes fail with a report.

```bash
bun run schema:status   # dry-run
bun run schema:apply    # apply (backup first)
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `DATABASE_URL` | `file:./data/app.db` | libSQL connection URL |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token (if using `libsql://`) |
| `BETTER_AUTH_SECRET` | *(dev auto-generated)* | **Required in production** |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL for auth |
| `CORS_ORIGINS` | `*` | Explicit list required in production |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_PATH` | `./data/uploads` | Local upload directory (local driver) |
| `MAX_FILE_SIZE` | `52428800` (50MB) | Max upload size |
| `S3_BUCKET` | — | Required when `STORAGE_DRIVER=s3` |
| `S3_REGION` / `S3_ENDPOINT` | — | Region and/or custom endpoint (MinIO, R2, …) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Required when `STORAGE_DRIVER=s3` |
| `S3_PREFIX` | — | Key prefix applied inside the S3 driver |
| `FILES_DOWNLOAD_MODE` | `proxy` | `proxy` (stream via Base) or `redirect` (presigned URL) |
| `S3_PRESIGN_EXPIRES` | `300` | Presigned URL TTL (seconds) |
| `HARD_DELETE_ENABLED` | `false` | Allow `?hard=true` deletes |
| `REALTIME_ENABLED` | `true` | SSE subscriptions |
| `REALTIME_REPLAY_BUFFER` | `100` | Ring buffer size for `Last-Event-ID` replay |
| `LITESTREAM_BUCKET` | — | Separate bucket for Litestream (may share `S3_*` credentials) |

## Deployment

### Docker

```bash
docker build -t base .
docker run -p 3000:3000 \
  -v ./data:/app/data \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e CORS_ORIGINS=https://your-app.example \
  -e NODE_ENV=production \
  base
```

### Docker Compose

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose up
```

### With Litestream (replication to S3)

```bash
# Terminal 1: App
bun run src/index.ts

# Terminal 2: Litestream
litestream replicate -config litestream.yml
```

### With Turso (managed libSQL)

```bash
turso db create base-prod
export DATABASE_URL=libsql://base-prod-<user>.turso.io
export DATABASE_AUTH_TOKEN=...
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
bun run src/index.ts
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| HTTP | Hono |
| Database | libSQL / SQLite (`@libsql/client`) |
| ORM | Drizzle ORM (Better Auth tables) |
| Auth | Better Auth |
| Validation | Zod |
| Replication | Litestream (optional) / Turso (optional) |

## License

MIT
