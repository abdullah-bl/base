# Base

A minimalistic, self-hosted Backend-as-a-Service. SQLite + Drizzle + Better Auth + file uploads. An alternative to Supabase, PocketBase, and Convex.

```bash
bun run src/index.ts  # 🚀 running on :3000
```

## Features

- **Schema-to-API** — Define collections in TypeScript, get REST CRUD + validation automatically
- **Auth** — Email/password, sessions, OAuth-ready (Better Auth)
- **Files** — Upload, download, delete with ownership tracking
- **SQLite** — libSQL/SQLite embedded, zero-config
- **Replication** — Litestream sidecar for disaster recovery (optional)
- **Lightweight** — Single Bun process, ~50MB

## Quick Start

```bash
# Install
bun install

# Start dev server
bun run dev

# Server runs at http://localhost:3000
```

## Define Collections

Edit `collections.ts`:

```typescript
import { defineCollection, f } from './src/schema/define.js'
import { register } from './src/schema/index-registry.js'

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
})

register(posts)
```

Tables are auto-created on server start. Routes are auto-mounted.

## API

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-up/email` | Register `{ email, password, name }` |
| POST | `/api/auth/sign-in/email` | Login `{ email, password }` |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/auth/get-session` | Current session |
| GET | `/api/auth/me` | Current user (auth required) |

### Collections (auto-generated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/collections/:name` | List — `?filter[x]=y&sort=-createdAt&page=1&perPage=20` |
| GET | `/api/collections/:name/:id` | Get by ID |
| POST | `/api/collections/:name` | Create |
| PATCH | `/api/collections/:name/:id` | Update (partial) |
| DELETE | `/api/collections/:name/:id` | Delete (`?hard=true` for hard delete) |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files` | Upload (multipart, `file` field) |
| GET | `/api/files/:id` | Download |
| GET | `/api/files` | List user's files |
| DELETE | `/api/files/:id` | Delete |

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
| `f.vector(1536)` | number[] | `f.vector(1536).optional()` *(Phase 7)* |

Modifiers: `.required()`, `.optional()`, `.default(val)`, `.unique()`, `.max(n)`, `.min(n)`

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | `file:./data/app.db` | libSQL connection URL |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token (if using `libsql://`) |
| `BETTER_AUTH_SECRET` | *(auto-generated)* | Session encryption key |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL for auth |
| `CORS_ORIGINS` | `*` | Comma-separated origins |
| `STORAGE_PATH` | `./data/uploads` | File upload directory |
| `MAX_FILE_SIZE` | `52428800` (50MB) | Max upload size |

## Deployment

### Docker

```bash
docker build -t base .
docker run -p 3000:3000 \
  -v ./data:/app/data \
  -e BETTER_AUTH_SECRET=your-secret \
  base
```

### Docker Compose (with MinIO for S3 testing)

```bash
docker compose --profile storage up
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
# Create database
turso db create base-prod

# Set DATABASE_URL to remote
export DATABASE_URL=libsql://base-prod-<user>.turso.io
export DATABASE_AUTH_TOKEN=eyJ...

# Same code, remote replicated database
bun run src/index.ts
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| HTTP | Hono |
| Database | libSQL / SQLite (`@libsql/client`) |
| ORM | Drizzle ORM |
| Auth | Better Auth |
| Validation | Zod |
| Replication | Litestream (optional) / Turso (optional) |

## License

MIT
