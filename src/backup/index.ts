import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  createWriteStream,
} from 'node:fs'
import { join, basename } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { ulid } from 'ulid'
import env from '../env.js'
import { getClient, resetClientForTests } from '../db/client.js'
import { getDbPath, getUploadsDir, ensureDirectories } from '../config.js'
import { getRegisteredCollections } from '../schema/registry.js'
import { fingerprintCollection } from '../schema/evolve.js'
import {
  setMaintenanceMode,
  isMaintenanceMode,
} from '../server/maintenance.js'
import { autoMigrate } from '../db/migrate.js'
import { applyEvolution } from '../schema/evolve.js'
import { writeAudit } from '../observability/audit.js'

export interface BackupManifest {
  id: string
  version: string
  timestamp: number
  sha256: string
  dbFile: string
  schemaFingerprints: Record<string, string>
  includesUploads: boolean
  kind: 'vacuum' | 'jsonl'
  size: number
}

function backupDir(): string {
  const dir = join(process.cwd(), env.BACKUP_DIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function sha256File(path: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

export async function createBackup(opts?: {
  includeUploads?: boolean
}): Promise<BackupManifest> {
  ensureDirectories()
  const dir = backupDir()
  const id = ulid()
  const ts = Date.now()
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-')
  const dbPath = getDbPath()
  const fingerprints: Record<string, string> = {}
  for (const c of getRegisteredCollections()) {
    if (c.name === 'user' || c.name === 'users') continue
    fingerprints[c.name] = fingerprintCollection(c)
  }

  let dbFile: string
  let kind: 'vacuum' | 'jsonl'
  let size: number

  if (dbPath && env.DATABASE_URL.startsWith('file:')) {
    kind = 'vacuum'
    const target = join(dir, `base-${iso}-${id}.db`)
    const client = getClient()
    // VACUUM INTO creates a consistent snapshot
    await client.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    dbFile = basename(target)
    size = statSync(target).size
  } else {
    // Remote / Turso — logical JSONL export
    kind = 'jsonl'
    const target = join(dir, `base-${iso}-${id}.jsonl`)
    const client = getClient()
    const tables = await listAllTables()
    const lines: string[] = []
    for (const table of tables) {
      const rows = await client.execute(`SELECT * FROM "${table}"`)
      for (const row of rows.rows || []) {
        lines.push(JSON.stringify({ table, row }))
      }
    }
    writeFileSync(target, lines.join('\n') + (lines.length ? '\n' : ''))
    dbFile = basename(target)
    size = statSync(target).size
  }

  const fullDbPath = join(dir, dbFile)
  const sha256 = sha256File(fullDbPath)

  let includesUploads = false
  if (opts?.includeUploads && env.STORAGE_DRIVER === 'local') {
    const uploads = getUploadsDir()
    if (existsSync(uploads)) {
      // Copy uploads into a sibling directory named after the backup id
      const uploadsBackup = join(dir, `${id}-uploads`)
      mkdirSync(uploadsBackup, { recursive: true })
      copyDirRecursive(uploads, uploadsBackup)
      includesUploads = true
    }
  }

  const manifest: BackupManifest = {
    id,
    version: '0.1.0',
    timestamp: ts,
    sha256,
    dbFile,
    schemaFingerprints: fingerprints,
    includesUploads,
    kind,
    size,
  }

  writeFileSync(
    join(dir, `${id}.manifest.json`),
    JSON.stringify(manifest, null, 2),
  )

  await pruneBackups()
  return manifest
}

async function listAllTables(): Promise<string[]> {
  const client = getClient()
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  return (result.rows || []).map((r) =>
    String((r as unknown as { name: string }).name),
  )
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(from, to)
    } else {
      copyFileSync(from, to)
    }
  }
}

export function listBackups(): BackupManifest[] {
  const dir = backupDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.manifest.json'))
  const manifests: BackupManifest[] = []
  for (const f of files) {
    try {
      manifests.push(
        JSON.parse(readFileSync(join(dir, f), 'utf8')) as BackupManifest,
      )
    } catch {
      // skip corrupt
    }
  }
  return manifests.sort((a, b) => b.timestamp - a.timestamp)
}

export function getBackup(id: string): BackupManifest | null {
  return listBackups().find((b) => b.id === id) ?? null
}

export function getBackupFilePath(manifest: BackupManifest): string {
  return join(backupDir(), manifest.dbFile)
}

export async function deleteBackup(id: string): Promise<boolean> {
  const manifest = getBackup(id)
  if (!manifest) return false
  const dir = backupDir()
  const dbPath = join(dir, manifest.dbFile)
  const manifestPath = join(dir, `${id}.manifest.json`)
  const uploadsPath = join(dir, `${id}-uploads`)
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  if (existsSync(manifestPath)) rmSync(manifestPath, { force: true })
  if (existsSync(uploadsPath)) rmSync(uploadsPath, { recursive: true, force: true })
  return true
}

export async function pruneBackups(): Promise<number> {
  const keep = Math.max(1, env.BACKUP_RETENTION)
  const all = listBackups()
  if (all.length <= keep) return 0
  let removed = 0
  for (const m of all.slice(keep)) {
    await deleteBackup(m.id)
    removed++
  }
  return removed
}

export async function restoreBackup(
  id: string,
  opts?: { actorId?: string; requestId?: string },
): Promise<void> {
  const manifest = getBackup(id)
  if (!manifest) {
    throw Object.assign(new Error('Backup not found'), {
      status: 404,
      code: 'NOT_FOUND',
    })
  }

  const dbFile = getBackupFilePath(manifest)
  if (!existsSync(dbFile)) {
    throw Object.assign(new Error('Backup file missing'), {
      status: 404,
      code: 'NOT_FOUND',
    })
  }

  const hash = sha256File(dbFile)
  if (hash !== manifest.sha256) {
    throw Object.assign(new Error('Backup checksum mismatch'), {
      status: 400,
      code: 'CHECKSUM_MISMATCH',
    })
  }

  const liveDb = getDbPath()
  if (!liveDb || manifest.kind !== 'vacuum') {
    throw Object.assign(
      new Error(
        'Restore of JSONL/remote backups is not supported via swap. Use db import instead.',
      ),
      { status: 400, code: 'UNSUPPORTED' },
    )
  }

  if (isMaintenanceMode()) {
    throw Object.assign(new Error('Already in maintenance mode'), {
      status: 503,
      code: 'MAINTENANCE',
    })
  }

  setMaintenanceMode(true, 'Restoring backup')

  try {
    // Close client so file can be replaced
    try {
      getClient().close()
    } catch {
      // ignore
    }
    resetClientForTests()

    const preRestore = `${liveDb}.pre-restore-${Date.now()}`
    if (existsSync(liveDb)) {
      renameSync(liveDb, preRestore)
    }
    // Also move wal/shm if present
    for (const suffix of ['-wal', '-shm']) {
      const p = liveDb + suffix
      if (existsSync(p)) {
        renameSync(p, preRestore + suffix)
      }
    }

    copyFileSync(dbFile, liveDb)

    // Re-init
    const { initDb } = await import('../db/client.js')
    await initDb()
    await autoMigrate()
    await applyEvolution(
      getRegisteredCollections().filter(
        (c) => c.name !== 'user' && c.name !== 'users',
      ),
    )

    if (manifest.includesUploads && env.STORAGE_DRIVER === 'local') {
      const uploadsBackup = join(backupDir(), `${id}-uploads`)
      if (existsSync(uploadsBackup)) {
        const uploads = getUploadsDir()
        rmSync(uploads, { recursive: true, force: true })
        copyDirRecursive(uploadsBackup, uploads)
      }
    }

    await writeAudit({
      actor: opts?.actorId
        ? { kind: 'user', userId: opts.actorId }
        : { kind: 'system' },
      action: 'backup.restore',
      recordId: id,
      after: { id, timestamp: manifest.timestamp },
      requestId: opts?.requestId,
    })
  } finally {
    setMaintenanceMode(false)
  }
}

export async function gzipBackupFile(path: string): Promise<string> {
  const out = `${path}.gz`
  await pipeline(createReadStream(path), createGzip(), createWriteStream(out))
  return out
}

let scheduleTimer: ReturnType<typeof setInterval> | null = null

export function startBackupSchedule(): void {
  if (env.BACKUP_SCHEDULE_HOURS <= 0) return
  if (scheduleTimer) return
  const ms = env.BACKUP_SCHEDULE_HOURS * 60 * 60 * 1000
  scheduleTimer = setInterval(() => {
    void createBackup({ includeUploads: true }).catch(() => {
      // logged elsewhere
    })
  }, ms)
}

export function stopBackupSchedule(): void {
  if (scheduleTimer) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
}
