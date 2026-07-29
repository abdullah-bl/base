#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { VERSION } from '../version.js'

function printHelp() {
  console.log(`Base CLI v${VERSION}

Usage:
  base [command] [options]

Commands:
  serve                   Start the HTTP server (supervised by default)
  serve --no-supervise    Start worker only (no supervisor)
  init                    Scaffold .env, data/, optional collections.ts
  restart                 Request a supervised process restart
  doctor                  Check environment / DB / security
  doctor --security       Run security checklist
  version                 Print version

  admin create            Create an admin user (via sign-up + promote)
  admin promote <email>   Promote a user to admin by email
  admin reset-password    Reset a user's password (email + password)

  schema status           Dry-run schema evolution plan
  schema apply            Apply additive schema migrations
  schema diff             Alias for schema status

  db backup               Create a backup
  db restore <id>         Restore a backup
  db list                 List backups
  db prune                Prune old backups
  db query <sql>          Run a read-only SQL query
  db export [table]       Export table(s) as JSONL
  db import <file>        Import JSONL rows

  users list              List users
  users create            Create a user (email, password, name)
  users delete <id>       Delete a user
  users revoke-sessions <id>

  files list              List files
  files stats             File storage stats
  files prune-orphans     Remove DB records with missing storage objects

  logs tail               Tail recent in-memory logs (after boot ops)
  logs query              Query persisted logs

  generate client         Generate typed TypeScript client

Global options:
  --collections <path>    Path to collections module (default: ./collections.ts)
  --help, -h              Show help
`)
}

async function loadCollections(pathArg?: string) {
  const { existsSync } = await import('node:fs')
  const path = resolve(process.cwd(), pathArg || './collections.ts')
  if (!existsSync(path)) {
    console.log(`ℹ️  No collections file at ${path} — using DB schema store`)
    return
  }
  await import(pathToFileURL(path).href)
}

async function withDb(fn: () => Promise<void>, collectionsPath?: string) {
  const { bootstrap } = await import('../server/bootstrap.js')
  await bootstrap({
    serve: false,
    loadCollections: () => loadCollections(collectionsPath),
  })
  await fn()
}

async function runInit() {
  const { existsSync, mkdirSync, writeFileSync, readFileSync } = await import(
    'node:fs'
  )
  const cwd = process.cwd()
  mkdirSync(resolve(cwd, 'data'), { recursive: true })
  mkdirSync(resolve(cwd, 'data/uploads'), { recursive: true })
  mkdirSync(resolve(cwd, 'data/backups'), { recursive: true })

  const envPath = resolve(cwd, '.env')
  if (!existsSync(envPath)) {
    const example = resolve(cwd, '.env.example')
    if (existsSync(example)) {
      writeFileSync(envPath, readFileSync(example))
    } else {
      const secret = Buffer.from(await cryptoGetRandom(32)).toString('base64')
      writeFileSync(
        envPath,
        [
          `PORT=3000`,
          `DATABASE_URL=file:./data/app.db`,
          `BETTER_AUTH_SECRET=${secret}`,
          `BETTER_AUTH_URL=http://localhost:3000`,
          `CORS_ORIGINS=http://localhost:3000`,
          `ADMIN_ENABLED=true`,
          `STORAGE_DRIVER=local`,
          `STORAGE_PATH=./data/uploads`,
          `BACKUP_DIR=./data/backups`,
          '',
        ].join('\n'),
      )
    }
    console.log('✅ Created .env')
  } else {
    console.log('ℹ️  .env already exists — skipped')
  }

  const collectionsPath = resolve(cwd, 'collections.ts')
  if (!existsSync(collectionsPath)) {
    writeFileSync(
      collectionsPath,
      `/**
 * Optional legacy seed file. Prefer Admin → Collections (DB-backed schema).
 * On first boot, collections defined here are imported into the database once.
 */
import { defineCollection, f } from './src/schema/define.js'

export const posts = defineCollection('posts', {
  fields: {
    title: f.string().required().max(200),
    content: f.text().optional(),
    slug: f.string().unique(),
    published: f.boolean().default(false),
    authorId: f.reference('user').required(),
  },
  access: {
    create: 'owner',
    read: 'owner',
    update: 'owner',
    delete: 'owner',
    ownerField: 'authorId',
  },
})
`,
    )
    console.log('✅ Created collections.ts (optional seed)')
  } else {
    console.log('ℹ️  collections.ts already exists — skipped')
  }

  console.log('✅ Init complete. Run: base serve')
}

async function cryptoGetRandom(n: number): Promise<Uint8Array> {
  const { randomBytes } = await import('node:crypto')
  return randomBytes(n)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      collections: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
      'include-uploads': { type: 'boolean' },
      confirm: { type: 'boolean' },
      level: { type: 'string' },
      page: { type: 'string' },
      security: { type: 'boolean' },
      'no-supervise': { type: 'boolean' },
      init: { type: 'boolean' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string', short: 'H' },
      reason: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  })

  if (values.help) {
    printHelp()
    return
  }

  const cmd = positionals[0] || 'serve'
  const sub = positionals[1]
  const collectionsPath = values.collections as string | undefined

  if (cmd === 'version') {
    console.log(VERSION)
    return
  }

  if (cmd === 'init') {
    await runInit()
    return
  }

  if (cmd === 'restart') {
    // CLI restart: signal supervised worker via env file / direct exit when supervised
    if (process.env.BASE_SUPERVISED === '1') {
      const { RESTART_EXIT_CODE } = await import('../server/restart.js')
      console.log('🔄 Requesting supervised restart…')
      process.exit(RESTART_EXIT_CODE)
    }
    console.error(
      'base restart requires a supervised process (base serve). Use Admin UI → System → Restart, or run under supervisor.',
    )
    process.exit(1)
  }

  if (cmd === 'serve') {
    if (values.init) {
      await runInit()
    }

    const noSupervise = Boolean(values['no-supervise'])
    const isWorker =
      process.env.BASE_ROLE === 'worker' || process.env.BASE_SUPERVISED === '1'

    if (!noSupervise && !isWorker && process.env.BASE_ROLE !== 'supervisor') {
      const { runSupervisor } = await import('../server/supervisor.js')
      const workerArgs = [Bun.argv[1], 'serve', '--no-supervise']
      if (collectionsPath) workerArgs.push('--collections', collectionsPath)
      if (values.port) workerArgs.push('--port', String(values.port))
      await runSupervisor({
        execPath: process.execPath,
        workerArgs,
      })
      return
    }

    if (values.port) {
      process.env.PORT = String(values.port)
    }

    const { bootstrap } = await import('../server/bootstrap.js')
    await bootstrap({
      serve: true,
      loadCollections: () => loadCollections(collectionsPath),
      port: values.port ? Number(values.port) : undefined,
    })
    return
  }

  if (cmd === 'doctor') {
    await withDb(async () => {
      const { getClient } = await import('../db/client.js')
      const env = (await import('../env.js')).default
      await getClient().execute('SELECT 1')
      console.log('✅ Database reachable')
      console.log(`   DATABASE_URL=${env.DATABASE_URL}`)
      console.log(`   STORAGE_DRIVER=${env.STORAGE_DRIVER}`)
      console.log(`   ADMIN_ENABLED=${env.ADMIN_ENABLED}`)
      console.log(`   REALTIME_ENABLED=${env.REALTIME_ENABLED}`)

      if (values.security) {
        const { runSecurityChecklist } = await import(
          '../security/checklist.js'
        )
        const report = await runSecurityChecklist()
        console.log(`\n🔒 Security score: ${report.score}/100`)
        for (const check of report.checks) {
          console.log(
            `   ${check.ok ? '✅' : '❌'} [${check.severity}] ${check.title} — ${check.detail}`,
          )
        }
        if (report.failed > 0) process.exitCode = 1
        return
      }

      const { getRegisteredCollections } = await import(
        '../schema/registry.js'
      )
      const cols = getRegisteredCollections().filter(
        (c) => c.name !== 'user' && c.name !== 'users',
      )
      console.log(`   Collections: ${cols.map((c) => c.name).join(', ') || '(none)'}`)
    }, collectionsPath)
    return
  }

  if (cmd === 'schema') {
    await withDb(async () => {
      const { applyEvolution, formatPlan } = await import(
        '../schema/evolve.js'
      )
      const { getRegisteredCollections } = await import(
        '../schema/registry.js'
      )
      const collections = getRegisteredCollections().filter(
        (c) => c.name !== 'user' && c.name !== 'users',
      )
      if (sub === 'apply') {
        console.log('⚠️  Ensure you have a backup before applying.')
        const plan = await applyEvolution(collections, { dryRun: false })
        console.log(formatPlan(plan))
        console.log('✅ Schema evolution applied')
      } else {
        const plan = await applyEvolution(collections, { dryRun: true })
        console.log(formatPlan(plan))
        if (plan.blocked.length > 0) process.exitCode = 1
      }
    }, collectionsPath)
    return
  }

  if (cmd === 'admin') {
    await withDb(async () => {
      const { getClient } = await import('../db/client.js')
      const { setUserRole, getAuth } = await import('../auth/auth.js')
      if (sub === 'promote') {
        const email = positionals[2] || (values.email as string)
        if (!email) {
          console.error('Usage: base admin promote <email>')
          process.exit(1)
        }
        const r = await getClient().execute({
          sql: `SELECT "id" FROM "user" WHERE lower("email") = lower(?)`,
          args: [email],
        })
        const id = r.rows?.[0]?.id as string | undefined
        if (!id) {
          console.error('User not found')
          process.exit(1)
        }
        await setUserRole(id, 'admin')
        console.log(`✅ Promoted ${email} to admin`)
        return
      }
      if (sub === 'create') {
        const email = values.email as string
        const password = values.password as string
        const name = (values.name as string) || 'Admin'
        if (!email || !password) {
          console.error(
            'Usage: base admin create --email <email> --password <password> [--name Name]',
          )
          process.exit(1)
        }
        const auth = getAuth()
        await auth.api.signUpEmail({
          body: { email, password, name },
        })
        const r = await getClient().execute({
          sql: `SELECT "id" FROM "user" WHERE lower("email") = lower(?)`,
          args: [email],
        })
        const id = r.rows?.[0]?.id as string | undefined
        if (id) await setUserRole(id, 'admin')
        console.log(`✅ Admin user created: ${email}`)
        return
      }
      if (sub === 'reset-password') {
        console.error(
          'reset-password: use Better Auth forgot-password flow or update the account.password hash manually. Prefer admin promote + sign-in for recovery with ADMIN_TOKEN.',
        )
        process.exit(1)
      }
      console.error('Unknown admin subcommand. Use create|promote|reset-password')
      process.exit(1)
    }, collectionsPath)
    return
  }

  if (cmd === 'db') {
    await withDb(async () => {
      const backup = await import('../backup/index.js')
      const { getClient } = await import('../db/client.js')
      if (sub === 'backup') {
        const m = await backup.createBackup({
          includeUploads: values['include-uploads'] !== false,
        })
        console.log(JSON.stringify(m, null, 2))
        return
      }
      if (sub === 'list') {
        console.log(JSON.stringify(backup.listBackups(), null, 2))
        return
      }
      if (sub === 'prune') {
        const n = await backup.pruneBackups()
        console.log(`Pruned ${n} backup(s)`)
        return
      }
      if (sub === 'restore') {
        const id = positionals[2]
        if (!id) {
          console.error('Usage: base db restore <id>')
          process.exit(1)
        }
        await backup.restoreBackup(id)
        console.log(`✅ Restored backup ${id}`)
        return
      }
      if (sub === 'query') {
        const sql = positionals.slice(2).join(' ')
        if (!sql) {
          console.error('Usage: base db query <sql>')
          process.exit(1)
        }
        const { executeSql } = await import('../admin/data.js')
        const result = await executeSql(sql, {
          confirmWrite: Boolean(values.confirm),
        })
        console.log(JSON.stringify(result, null, 2))
        return
      }
      if (sub === 'export') {
        const table = positionals[2]
        const client = getClient()
        const tables = table
          ? [table]
          : (
              await client.execute(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
              )
            ).rows!.map((r) =>
                String((r as unknown as { name: string }).name),
              )
        for (const t of tables) {
          const rows = await client.execute(`SELECT * FROM "${t}"`)
          for (const row of rows.rows || []) {
            console.log(JSON.stringify({ table: t, row }))
          }
        }
        return
      }
      if (sub === 'import') {
        const file = positionals[2]
        if (!file) {
          console.error('Usage: base db import <file.jsonl>')
          process.exit(1)
        }
        const text = await Bun.file(file).text()
        const client = getClient()
        let n = 0
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          const { table, row } = JSON.parse(line) as {
            table: string
            row: Record<string, unknown>
          }
          const cols = Object.keys(row)
          const placeholders = cols.map(() => '?').join(', ')
          await client.execute({
            sql: `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
            args: Object.values(row) as any[],
          })
          n++
        }
        console.log(`✅ Imported ${n} row(s)`)
        return
      }
      console.error(
        'Unknown db subcommand. Use backup|restore|list|prune|query|export|import',
      )
      process.exit(1)
    }, collectionsPath)
    return
  }

  if (cmd === 'users') {
    await withDb(async () => {
      const { getClient } = await import('../db/client.js')
      const { getAuth } = await import('../auth/auth.js')
      if (sub === 'list') {
        const r = await getClient().execute(
          `SELECT "id", "name", "email", "role", "createdAt" FROM "user" ORDER BY "createdAt" DESC`,
        )
        console.log(JSON.stringify(r.rows, null, 2))
        return
      }
      if (sub === 'create') {
        const email = values.email as string
        const password = values.password as string
        const name = (values.name as string) || 'User'
        if (!email || !password) {
          console.error(
            'Usage: base users create --email <email> --password <password> [--name Name]',
          )
          process.exit(1)
        }
        await getAuth().api.signUpEmail({
          body: { email, password, name },
        })
        console.log(`✅ Created user ${email}`)
        return
      }
      if (sub === 'delete') {
        const id = positionals[2]
        if (!id) {
          console.error('Usage: base users delete <id>')
          process.exit(1)
        }
        const client = getClient()
        await client.execute({
          sql: `DELETE FROM "session" WHERE "userId" = ?`,
          args: [id],
        })
        await client.execute({
          sql: `DELETE FROM "account" WHERE "userId" = ?`,
          args: [id],
        })
        await client.execute({
          sql: `DELETE FROM "user" WHERE "id" = ?`,
          args: [id],
        })
        console.log(`✅ Deleted user ${id}`)
        return
      }
      if (sub === 'revoke-sessions') {
        const id = positionals[2]
        if (!id) {
          console.error('Usage: base users revoke-sessions <id>')
          process.exit(1)
        }
        const r = await getClient().execute({
          sql: `DELETE FROM "session" WHERE "userId" = ?`,
          args: [id],
        })
        console.log(`✅ Revoked ${r.rowsAffected || 0} session(s)`)
        return
      }
      console.error(
        'Unknown users subcommand. Use list|create|delete|revoke-sessions',
      )
      process.exit(1)
    }, collectionsPath)
    return
  }

  if (cmd === 'files') {
    await withDb(async () => {
      const { listAllFileRecords, deleteFileRecord } = await import(
        '../files/meta.js'
      )
      const { getStorageDriver } = await import('../files/storage.js')
      const env = (await import('../env.js')).default
      if (sub === 'list') {
        const r = await listAllFileRecords(1, 200)
        console.log(JSON.stringify(r, null, 2))
        return
      }
      if (sub === 'stats') {
        const r = await listAllFileRecords(1, 1)
        console.log(
          JSON.stringify(
            { total: r.meta.total, driver: env.STORAGE_DRIVER },
            null,
            2,
          ),
        )
        return
      }
      if (sub === 'prune-orphans') {
        const r = await listAllFileRecords(1, 1000)
        const driver = getStorageDriver()
        let pruned = 0
        for (const f of r.data) {
          const exists = await driver.exists(f.storageKey)
          if (!exists) {
            await deleteFileRecord(f.id)
            pruned++
          }
        }
        console.log(`✅ Pruned ${pruned} orphan record(s)`)
        return
      }
      console.error('Unknown files subcommand. Use list|stats|prune-orphans')
      process.exit(1)
    }, collectionsPath)
    return
  }

  if (cmd === 'logs') {
    await withDb(async () => {
      const { queryLogs, getRecentLogs } = await import(
        '../observability/bus.js'
      )
      if (sub === 'tail') {
        console.log(JSON.stringify(getRecentLogs(50), null, 2))
        return
      }
      const result = await queryLogs({
        level: values.level as string | undefined,
        page: values.page ? Number(values.page) : 1,
      })
      console.log(JSON.stringify(result, null, 2))
    }, collectionsPath)
    return
  }

  if (cmd === 'generate' && sub === 'client') {
    // Reuse existing generator by spawning
    const proc = Bun.spawn(['bun', 'run', 'scripts/generate-client.ts'], {
      stdout: 'inherit',
      stderr: 'inherit',
      cwd: process.cwd(),
    })
    const code = await proc.exited
    process.exit(code)
  }

  printHelp()
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
