import { S3Client } from 'bun'
import type { StorageDriver, DownloadResult } from '../driver.js'

export interface S3DriverOptions {
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  /** Applied inside the driver — not stored in DB metadata */
  prefix?: string
  downloadMode: 'proxy' | 'redirect'
  presignExpires: number
}

function withPrefix(prefix: string, key: string): string {
  if (!prefix) return key
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`
  return `${normalized}${key}`
}

export function createS3Driver(opts: S3DriverOptions): StorageDriver {
  const client = new S3Client({
    bucket: opts.bucket,
    region: opts.region,
    endpoint: opts.endpoint,
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
  })
  const prefix = opts.prefix || ''

  return {
    name: 's3',

    async put(key, data, mimeType) {
      const objectKey = withPrefix(prefix, key)
      await client.write(objectKey, data, { type: mimeType })
      return { size: data.byteLength }
    },

    async download(key, mimeType): Promise<DownloadResult | null> {
      const objectKey = withPrefix(prefix, key)
      const file = client.file(objectKey)

      const exists = await file.exists()
      if (!exists) return null

      if (opts.downloadMode === 'redirect') {
        const url = file.presign({
          method: 'GET',
          expiresIn: opts.presignExpires,
          type: mimeType,
        })
        return { kind: 'redirect', url }
      }

      return { kind: 'stream', body: file.stream() }
    },

    async delete(key) {
      const objectKey = withPrefix(prefix, key)
      try {
        await client.delete(objectKey)
        return true
      } catch {
        return false
      }
    },

    async exists(key) {
      const objectKey = withPrefix(prefix, key)
      try {
        return await client.exists(objectKey)
      } catch {
        return false
      }
    },
  }
}
