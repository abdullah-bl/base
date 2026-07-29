import fs from 'node:fs'
import path from 'node:path'
import env from './env.js'

function resolveDbPath(): string | null {
  if (!env.DATABASE_URL.startsWith('file:')) {
    return null
  }
  return path.resolve(process.cwd(), env.DATABASE_URL.replace('file:', ''))
}

export function getUploadsDir(): string {
  return path.resolve(process.cwd(), env.STORAGE_PATH)
}

export function getBackupDir(): string {
  const configured = env.BACKUP_DIR
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(process.cwd(), configured)
}

export function getDbPath(): string | null {
  return resolveDbPath()
}

export function ensureDirectories(): void {
  const dirs: string[] = []
  const db = resolveDbPath()
  if (db) {
    dirs.push(path.dirname(db))
  }
  // Only create local uploads dir when using the local storage driver
  if (env.STORAGE_DRIVER === 'local') {
    dirs.push(getUploadsDir())
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`📁 Created directory: ${dir}`)
    }
  }
}

// Eager create for production boot
ensureDirectories()

/** @deprecated use getDbPath() */
export const dbPath = resolveDbPath()
/** @deprecated use getUploadsDir() */
export const storagePath = getUploadsDir()
/** @deprecated use getUploadsDir() */
export const uploadsDir = getUploadsDir()

/** Runtime override set by settings layer after init */
let hardDeleteOverride: boolean | null = null

export function setHardDeleteOverride(value: boolean | null): void {
  hardDeleteOverride = value
}

export const config = {
  AUTO_MIGRATE: true,
  SOFT_DELETE: true,
  get HARD_DELETE_ENABLED() {
    if (typeof hardDeleteOverride === 'boolean') return hardDeleteOverride
    return env.HARD_DELETE_ENABLED
  },
}
