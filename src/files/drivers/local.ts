import fs from 'node:fs/promises'
import path from 'node:path'
import { getUploadsDir, ensureDirectories } from '../../config.js'
import type { StorageDriver, DownloadResult } from '../driver.js'

function resolveSafePath(storageKey: string): string | null {
  // Reject path separators / traversal
  if (
    !storageKey ||
    storageKey.includes('..') ||
    storageKey.includes('/') ||
    storageKey.includes('\\')
  ) {
    return null
  }
  const uploadsDir = getUploadsDir()
  const filepath = path.resolve(uploadsDir, storageKey)
  const root = path.resolve(uploadsDir)
  if (!filepath.startsWith(root + path.sep) && filepath !== root) {
    return null
  }
  return filepath
}

export function createLocalDriver(): StorageDriver {
  return {
    name: 'local',

    async put(key, data, _mimeType) {
      ensureDirectories()
      const filepath = resolveSafePath(key)
      if (!filepath) {
        throw new Error('Invalid storage key')
      }
      const uploadsDir = getUploadsDir()
      await fs.mkdir(uploadsDir, { recursive: true })

      if (typeof Bun !== 'undefined' && Bun.write) {
        await Bun.write(filepath, data)
      } else {
        await fs.writeFile(filepath, data)
      }
      return { size: data.byteLength }
    },

    async download(key, _mimeType): Promise<DownloadResult | null> {
      const filepath = resolveSafePath(key)
      if (!filepath) return null

      try {
        await fs.access(filepath)
      } catch {
        return null
      }

      if (typeof Bun !== 'undefined') {
        const bunFile = Bun.file(filepath)
        if (!(await bunFile.exists())) return null
        return { kind: 'stream', body: bunFile.stream() }
      }

      const buf = await fs.readFile(filepath)
      return { kind: 'stream', body: new Uint8Array(buf) }
    },

    async delete(key) {
      const filepath = resolveSafePath(key)
      if (!filepath) return false
      try {
        await fs.unlink(filepath)
        return true
      } catch {
        return false
      }
    },

    async exists(key) {
      const filepath = resolveSafePath(key)
      if (!filepath) return false
      try {
        await fs.access(filepath)
        return true
      } catch {
        return false
      }
    },
  }
}

/** Exported for unit tests that need to exercise path rejection. */
export { resolveSafePath as resolveSafePathForTests }
