#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = '0.1.0'

function printHelp() {
  console.log(`Base CLI v${VERSION}

Usage:
  base [command] [options]

Commands:
  serve                   Start the HTTP server (default)
  doctor                  Check environment / DB connectivity
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
  const path = resolve(process.cwd(), pathArg || './collections.ts')
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

  if (cmd === 'serve') {
    const { bootstrap } = await import('../server/bootstrap.js')
    await bootstrap({
      serve: true,
      loadCollections: () => loadCollections(collectionsPath),
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
