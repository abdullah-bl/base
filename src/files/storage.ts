import fs from 'node:fs'
import path from 'node:path'
import { ulid } from 'ulid'
import { uploadsDir } from '../config.js'

export interface StoredFile {
  buffer: Buffer
  filename: string
  storageKey: string
  mimeType: string
  size: number
}

/**
 * Save a file to local disk storage.
 * Returns the storage key (relative path) for retrieval.
 */
export async function saveFile(
  data: ArrayBuffer,
  originalName: string,
  mimeType: string,
): Promise<StoredFile> {
  const ext = path.extname(originalName) || mimeToExt(mimeType)
  const filename = `${ulid()}${ext}`
  const storageKey = filename
  const filepath = path.resolve(uploadsDir, filename)

  // Ensure uploads dir exists
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }

  const buffer = Buffer.from(data)
  fs.writeFileSync(filepath, buffer)

  return {
    buffer,
    filename,
    storageKey,
    mimeType,
    size: buffer.length,
  }
}

/**
 * Read a file from local disk.
 */
export async function getFile(storageKey: string): Promise<Buffer | null> {
  const filepath = path.resolve(uploadsDir, storageKey)

  if (!fs.existsSync(filepath)) return null

  return fs.readFileSync(filepath)
}

/**
 * Delete a file from local disk.
 */
export async function deleteFile(storageKey: string): Promise<boolean> {
  const filepath = path.resolve(uploadsDir, storageKey)

  if (!fs.existsSync(filepath)) return false

  fs.unlinkSync(filepath)
  return true
}

/**
 * Get the full path for a storage key.
 */
export function getFilePath(storageKey: string): string {
  return path.resolve(uploadsDir, storageKey)
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
