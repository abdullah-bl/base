# Base

A minimalistic, self-hosted Backend-as-a-Service. SQLite + Drizzle + Better Auth + file uploads. An alternative to Supabase, PocketBase, and Convex — with a code-first TypeScript schema and minimal overhead.

```bash
bun run src/index.ts  # running on :3000
```

## Features

- **Schema-to-API** — Define collections in TypeScript, get REST CRUD + validation automatically
- **Auth** — Email/password, sessions, roles, API keys (Better Auth)
- **Access rules** — Compact owner / authenticated / public policies per collection
- **Rich queries** — Filter operators (`gte`, `like`, `in`, …) + text search
- **Realtime** — SSE collection-change subscriptions, filtered by access rules
- **Webhooks** — Optional outbound delivery of change events
- **Files** — Upload, download, delete with ownership tracking (local disk or S3)
- **Admin panel** — Data viewer, logs, audit, backups, SQL console at `/_`
- **Backup / restore** — `VACUUM INTO` snapshots with checksum manifests
- **CLI** — `base` standalone CLI; compile to a single Bun executable (Admin UI embedded)
- **OpenAPI** — Spec at `/api/openapi.json` generated from the registry
- **SQLite** — libSQL/SQLite embedded, zero-config (Turso-ready)
- **Schema evolution** — Additive column/index migrations with dry-run CLI
- **Typed client** — Generate a TypeScript client from your collections (incl. `.subscribe()`)
- **Replication** — Litestream sidecar for disaster recovery (optional)
- **Lightweight** — Single Bun process

## Quick Start

### Binary (recommended)

Download the binary for your platform from the
[latest release](https://github.com/abdullah-bl/base/releases/latest):

```bash
# Linux x64
curl -fL https://github.com/abdullah-bl/base/releases/latest/download/base-linux-x64 \
  -o base
chmod +x base
sudo mv base /usr/local/bin/base

mkdir my-backend && cd my-backend
base init
base serve
# Admin UI → http://localhost:3000/_/
```

Available builds: `base-linux-x64`, `base-linux-arm64`,
`base-darwin-arm64`, and `base-windows-x64.exe`. Each release also includes
`AGENTS.md` as the operational and architecture guide.

Site: [abdullah-bl.github.io/base](https://abdullah-bl.github.io/base/) · Releases: [github.com/abdullah-bl/base/releases](https://github.com/abdullah-bl/base/releases)

### From source

```bash
bun install
cp .env.example .env
bun run build:admin
bun run dev
# Server → http://localhost:3000 · Admin → http://localhost:3000/_/
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
| GET | `/api/collections/:name` | List — `?filter={"x":"y"}` / `{"viewCount__gte":10}` / `filter[x__like]=%foo%` + `?search=` + sort/page |
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

### Health / OpenAPI

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | `{ status, timestamp, version, uptime }` |
| GET | `/api/health/live` | Liveness probe |
| GET | `/api/health/ready` | Readiness (DB + maintenance check) |
| GET | `/api/openapi.json` | OpenAPI 3 spec from registered collections |

### Admin API

All `/api/admin/*` routes require `role=admin` session **or** `X-Admin-Token`. First registered user is promoted to admin; set `ADMIN_EMAILS` / `ADMIN_TOKEN` for bootstrap.

| Area | Endpoints |
|------|-----------|
| Overview / settings | `GET /overview`, `GET /settings`, `GET /metrics` |
| Data viewer | `GET /data`, `GET|PATCH|DELETE /data/:table/:id` |
| SQL console | `POST /sql` (writes need `{ confirm: true }`) |
| Schema | `GET /collections`, `GET /schema/status`, `POST /schema/apply`, `GET /migrations` |
| Logs / audit | `GET /logs`, `GET /logs/stream`, `GET /audit` |
| Users / files | `GET /users`, `PATCH /users/:id/role`, `GET /files`, … |
| Backups | `GET|POST /backups`, `POST /backups/:id/restore`, … |
| API keys / webhooks | `GET|POST /api-keys`, `GET|POST /webhooks` |

Admin UI: build with `bun run build:admin`, open `http://localhost:3000/_/`.

### CLI

Empty folder / Docker (single binary — Admin UI embedded):

```bash
# Download the matching release binary (Linux x64 shown)
curl -fL https://github.com/abdullah-bl/base/releases/latest/download/base-linux-x64 \
  -o base
chmod +x base
sudo mv base /usr/local/bin/base

mkdir my-backend && cd my-backend
base init                   # .env, collections.ts, data/ (skips existing)
base serve                  # HOST:PORT default 0.0.0.0:3000
base serve --init           # scaffold if needed, then serve
base serve -p 8080 -H 0.0.0.0
```

Tag a release to publish the platform binaries and `AGENTS.md`:
`git tag vX.Y.Z && git push origin vX.Y.Z` (see `.github/workflows/release.yml`).

From source:

```bash
bun run cli -- init
bun run cli -- serve
bun run cli -- doctor
bun run cli -- schema status
bun run cli -- db backup
bun run cli -- admin promote you@example.com
```

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
| `PORT` | `3000` | Server port (`--port` / `-p`) |
| `HOST` | `0.0.0.0` | Bind address (`--host` / `--hostname` / `-H`). Do not use `HOSTNAME` — Docker sets that. |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `DATABASE_URL` | `file:./data/app.db` | libSQL connection URL |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token (if using `libsql://`) |
| `BETTER_AUTH_SECRET` | *(dev auto-generated)* | **Required in production** |
| `SETTINGS_ENCRYPTION_KEY` | — | Optional dedicated key for encrypting sensitive Admin → Settings values at rest (falls back to `BETTER_AUTH_SECRET`) |
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
| `ADMIN_ENABLED` | `true` | Serve admin API + UI |
| `ADMIN_PATH` | `/_` | Admin UI mount path |
| `ADMIN_DIST_DIR` | — | Optional on-disk admin SPA override (binaries embed the UI by default) |
| `ADMIN_TOKEN` | — | Break-glass admin header (min 32 chars) |
| `ADMIN_EMAILS` | — | Comma-separated emails auto-promoted to admin |
| `LOG_LEVEL` / `LOG_PERSIST` | `info` / `true` | Structured logging |
| `BACKUP_DIR` / `BACKUP_RETENTION` | `./data/backups` / `10` | Snapshot storage |
| `RATE_LIMIT_ENABLED` | `true` | In-memory rate limiting |
| `TRUST_PROXY` | `false` | Honor `X-Forwarded-For` / `X-Real-Ip` (only behind a stripping proxy) |
| `WEBHOOKS_ENABLED` | `false` | Outbound change webhooks |
| `SMTP_PASSWORD` | — | SMTP auth password (env-only; host/port/from editable in Admin → Settings) |
| `OAUTH_GITHUB_*` / `OAUTH_GOOGLE_*` | off | Social login; also editable in Admin → Settings (restart to apply) |
| `MCP_ENABLED` / `MCP_PATH` | `false` / `/api/mcp` | MCP JSON-RPC endpoint for agents; also editable in Admin → Settings |
| `LITESTREAM_BUCKET` | — | Separate bucket for Litestream (may share `S3_*` credentials) |

### Runtime settings (Admin → Settings)

Many operational flags (rate limits, logging, realtime, SMTP host/from, OAuth client IDs/secrets, MCP toggles, etc.) can be overridden at runtime via **Admin → Settings** (`GET`/`PATCH /api/admin/settings`).

- **Precedence:** database override → environment → schema default
- **Boot env is read-only:** the admin UI never writes `.env` / process environment. Structural secrets such as `BETTER_AUTH_SECRET`, `ADMIN_TOKEN`, S3 keys, and `SMTP_PASSWORD` stay env-only.
- **Sensitive values:** marked settings (e.g. OAuth client secrets) are stored encrypted in `_base_settings` (AES-256-GCM). API responses return `[REDACTED]` / `configured: true`; blank PATCH values keep the existing secret.
- **Encryption key:** set `SETTINGS_ENCRYPTION_KEY` in production (recommended). If unset, Base derives the key from `BETTER_AUTH_SECRET`.
- **Restart-required:** OAuth enablement, email verification, and MCP path changes rebuild or require a process restart; the UI surfaces which keys need a restart after save.

### Benchmarks

```bash
bun run bench:smoke   # local Base HTTP smoke (not part of CI)
bun run bench:stress  # larger seed + concurrency
```

See [`benchmarks/README.md`](benchmarks/README.md) and [`benchmarks/compare.md`](benchmarks/compare.md) for PocketBase comparison protocol.

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
# Compose profile
export LITESTREAM_BUCKET=my-replicas
docker compose --profile replicate up

# Or manually:
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
