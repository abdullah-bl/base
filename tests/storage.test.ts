import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalDriver, resolveSafePathForTests } from '../src/files/drivers/local.js'
import { createS3Driver } from '../src/files/drivers/s3.js'
import type { StorageDriver } from '../src/files/driver.js'

let tempDir: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'base-storage-'))
  process.env.STORAGE_PATH = tempDir
  process.env.STORAGE_DRIVER = 'local'
})

afterEach(() => {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDir = undefined
})

async function readDownload(driver: StorageDriver, key: string): Promise<Uint8Array> {
  const result = await driver.download(key, 'text/plain')
  expect(result).not.toBeNull()
  if (!result || result.kind !== 'stream') {
    throw new Error('expected stream')
  }

  if (result.body instanceof Uint8Array) {
    return result.body
  }

  const reader = result.body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

describe('local storage driver', () => {
  test('put / download / exists / delete', async () => {
    // Reset env cache so STORAGE_PATH is picked up
    const { resetEnvForTests, loadEnv } = await import('../src/env.js')
    resetEnvForTests()
    loadEnv(true)

    const driver = createLocalDriver()
    const key = '01HXTESTLOCAL0000000000001.txt'
    const payload = new TextEncoder().encode('hello storage')

    const put = await driver.put(key, payload, 'text/plain')
    expect(put.size).toBe(payload.byteLength)
    expect(await driver.exists(key)).toBe(true)

    const downloaded = await readDownload(driver, key)
    expect(new TextDecoder().decode(downloaded)).toBe('hello storage')

    expect(await driver.delete(key)).toBe(true)
    expect(await driver.exists(key)).toBe(false)
    expect(await driver.download(key, 'text/plain')).toBeNull()
  })

  test('rejects path traversal keys', async () => {
    const { resetEnvForTests, loadEnv } = await import('../src/env.js')
    resetEnvForTests()
    loadEnv(true)

    expect(resolveSafePathForTests('../etc/passwd')).toBeNull()
    expect(resolveSafePathForTests('foo/bar.txt')).toBeNull()
    expect(resolveSafePathForTests('foo\\bar.txt')).toBeNull()
    expect(resolveSafePathForTests('')).toBeNull()

    const driver = createLocalDriver()
    await expect(
      driver.put('../evil.txt', new Uint8Array([1]), 'text/plain'),
    ).rejects.toThrow()
  })
})

describe('s3 storage driver', () => {
  const bucket = process.env.S3_TEST_BUCKET

  test.skipIf(!bucket)(
    'put / download / exists / delete against live S3',
    async () => {
      const driver = createS3Driver({
        bucket: bucket!,
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
        prefix: process.env.S3_PREFIX || 'test/',
        downloadMode: 'proxy',
        presignExpires: 300,
      })

      const key = `01HXTESTS3${Date.now()}.txt`
      const payload = new TextEncoder().encode('hello s3')

      const put = await driver.put(key, payload, 'text/plain')
      expect(put.size).toBe(payload.byteLength)
      expect(await driver.exists(key)).toBe(true)

      const downloaded = await readDownload(driver, key)
      expect(new TextDecoder().decode(downloaded)).toBe('hello s3')

      expect(await driver.delete(key)).toBe(true)
      expect(await driver.exists(key)).toBe(false)
    },
    30000,
  )

  test.skipIf(!bucket)(
    'redirect mode returns a presigned URL',
    async () => {
      const driver = createS3Driver({
        bucket: bucket!,
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
        prefix: 'test/',
        downloadMode: 'redirect',
        presignExpires: 300,
      })

      const key = `01HXTESTREDIR${Date.now()}.txt`
      await driver.put(key, new TextEncoder().encode('redir'), 'text/plain')
      const result = await driver.download(key, 'text/plain')
      expect(result?.kind).toBe('redirect')
      if (result?.kind === 'redirect') {
        expect(result.url).toMatch(/^https?:\/\//)
      }
      await driver.delete(key)
    },
    30000,
  )
})
