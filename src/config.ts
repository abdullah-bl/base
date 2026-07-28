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

export function getDbPath(): string | null {
  return resolveDbPath()
}

export function ensureDirectories(): void {
  const dirs = [getUploadsDir()]
  const db = resolveDbPath()
  if (db) {
    dirs.unshift(path.dirname(db))
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

export const config = {
  AUTO_MIGRATE: true,
  SOFT_DELETE: true,
  get HARD_DELETE_ENABLED() {
    return env.HARD_DELETE_ENABLED
  },
}
