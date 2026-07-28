import fs from 'node:fs/promises'
import path from 'node:path'
import { ulid } from 'ulid'
import { getUploadsDir, ensureDirectories } from '../config.js'

export interface StoredFile {
  filename: string
  storageKey: string
  mimeType: string
  size: number
}

/**
 * Save a file to local disk storage using async I/O.
 * Accepts ArrayBuffer or Uint8Array — streams via Bun.write when available.
 */
export async function saveFile(
  data: ArrayBuffer | Uint8Array,
  originalName: string,
  mimeType: string,
): Promise<StoredFile> {
  ensureDirectories()
  const uploadsDir = getUploadsDir()
  const ext = path.extname(originalName) || mimeToExt(mimeType)
  const filename = `${ulid()}${ext}`
  const storageKey = filename
  const filepath = path.resolve(uploadsDir, filename)

  // Prevent path traversal — storage key is always a ULID basename
  if (path.basename(filepath) !== filename || !filepath.startsWith(path.resolve(uploadsDir))) {
    throw new Error('Invalid storage path')
  }

  await fs.mkdir(uploadsDir, { recursive: true })

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

  if (typeof Bun !== 'undefined' && Bun.write) {
    await Bun.write(filepath, bytes)
  } else {
    await fs.writeFile(filepath, bytes)
  }

  return {
    filename,
    storageKey,
    mimeType,
    size: bytes.byteLength,
  }
}

/**
 * Read a file from local disk (full buffer — prefer getFileResponse for serving).
 */
export async function getFile(storageKey: string): Promise<Uint8Array | null> {
  const filepath = resolveSafePath(storageKey)
  if (!filepath) return null

  try {
    await fs.access(filepath)
  } catch {
    return null
  }

  const buf = await fs.readFile(filepath)
  return new Uint8Array(buf)
}

/**
 * Return a Bun.File / Response-friendly path for streaming downloads.
 */
export function getFilePath(storageKey: string): string | null {
  return resolveSafePath(storageKey)
}

/**
 * Delete a file from local disk.
 */
export async function deleteFile(storageKey: string): Promise<boolean> {
  const filepath = resolveSafePath(storageKey)
  if (!filepath) return false

  try {
    await fs.unlink(filepath)
    return true
  } catch {
    return false
  }
}

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

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'application/zip': '.zip',
    'application/octet-stream': '.bin',
  }
  return map[mimeType] || '.bin'
}
