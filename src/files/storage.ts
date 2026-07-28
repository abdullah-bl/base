import path from 'node:path'
import { ulid } from 'ulid'
import env from '../env.js'
import type { StorageDriver } from './driver.js'
import { createLocalDriver } from './drivers/local.js'
import { createS3Driver } from './drivers/s3.js'

export interface StoredFile {
  filename: string
  storageKey: string
  mimeType: string
  size: number
}

let driver: StorageDriver | null = null

/**
 * Resolve (and cache) the active storage driver from env.
 */
export function getStorageDriver(): StorageDriver {
  if (driver) return driver

  if (env.STORAGE_DRIVER === 's3') {
    driver = createS3Driver({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      prefix: env.S3_PREFIX,
      downloadMode: env.FILES_DOWNLOAD_MODE,
      presignExpires: env.S3_PRESIGN_EXPIRES,
    })
  } else {
    driver = createLocalDriver()
  }

  return driver
}

/** Reset cached driver — for tests only. */
export function resetStorageDriverForTests(): void {
  driver = null
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

/**
 * Save a file via the active storage driver.
 * Generates a ULID-based storage key (flat basename, driver-agnostic).
 */
export async function saveFile(
  data: ArrayBuffer | Uint8Array,
  originalName: string,
  mimeType: string,
): Promise<StoredFile> {
  const ext = path.extname(originalName) || mimeToExt(mimeType)
  const filename = `${ulid()}${ext}`
  const storageKey = filename
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

  const { size } = await getStorageDriver().put(storageKey, bytes, mimeType)

  return {
    filename,
    storageKey,
    mimeType,
    size,
  }
}

/**
 * Delete a file via the active storage driver.
 */
export async function deleteFile(storageKey: string): Promise<boolean> {
  return getStorageDriver().delete(storageKey)
}
