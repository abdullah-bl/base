import { describe, test, expect, afterEach } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, isAbsolute } from 'node:path'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

const TOKEN = 'test-admin-token-at-least-32-characters-long'

describe('Backup / restore', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('create and list backup', async () => {
    ctx = await createTestContext()
    const create = await ctx.app.request(
      'http://localhost:3000/api/admin/backups',
      {
        method: 'POST',
        headers: {
          'X-Admin-Token': TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeUploads: false }),
      },
    )
    expect(create.status).toBe(201)
    const created = await json<{
      data: { id: string; sha256: string; dbFile: string }
    }>(create)
    expect(created.data.id).toBeTruthy()
    expect(created.data.sha256).toHaveLength(64)

    const list = await ctx.app.request(
      'http://localhost:3000/api/admin/backups',
      { headers: { 'X-Admin-Token': TOKEN } },
    )
    const listed = await json<{ data: { id: string }[] }>(list)
    expect(listed.data.some((b) => b.id === created.data.id)).toBe(true)

    const { getBackupFilePath, getBackup } = await import(
      '../src/backup/index.js'
    )
    const manifest = getBackup(created.data.id)
    expect(manifest).toBeTruthy()
    expect(existsSync(getBackupFilePath(manifest!))).toBe(true)
  })

  test('backup roundtrip restore', async () => {
    ctx = await createTestContext()
    // Seed a row via admin SQL
    await ctx.app.request('http://localhost:3000/api/admin/sql', {
      method: 'POST',
      headers: {
        'X-Admin-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: `INSERT INTO posts (id, title, slug, published, viewCount, authorId, createdAt, updatedAt, deletedAt) VALUES ('SEED1', 'Seed', 'seed-1', 0, 0, 'u1', ${Date.now()}, ${Date.now()}, NULL)`,
        confirm: true,
      }),
    })

    const create = await json<{ data: { id: string } }>(
      await ctx.app.request('http://localhost:3000/api/admin/backups', {
        method: 'POST',
        headers: {
          'X-Admin-Token': TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeUploads: false }),
      }),
    )

    // Delete the row
    await ctx.app.request('http://localhost:3000/api/admin/sql', {
      method: 'POST',
      headers: {
        'X-Admin-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: `DELETE FROM posts WHERE id = 'SEED1'`,
        confirm: true,
      }),
    })

    const restore = await ctx.app.request(
      `http://localhost:3000/api/admin/backups/${create.data.id}/restore`,
      {
        method: 'POST',
        headers: { 'X-Admin-Token': TOKEN },
      },
    )
    expect(restore.status).toBe(200)

    const check = await json<{ data: { rows: { id: string }[] } }>(
      await ctx.app.request('http://localhost:3000/api/admin/sql', {
        method: 'POST',
        headers: {
          'X-Admin-Token': TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: `SELECT id FROM posts WHERE id = 'SEED1'`,
        }),
      }),
    )
    expect(check.data.rows.length).toBe(1)
  })

  test('absolute BACKUP_DIR stores manifests under configured temp dir', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'base-backup-abs-'))
    try {
      ctx = await createTestContext({
        env: { BACKUP_DIR: backupRoot },
      })

      const create = await json<{ data: { id: string } }>(
        await ctx.app.request('http://localhost:3000/api/admin/backups', {
          method: 'POST',
          headers: {
            'X-Admin-Token': TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ includeUploads: false }),
        }),
      )

      const manifestPath = join(backupRoot, `${create.data.id}.manifest.json`)
      expect(isAbsolute(backupRoot)).toBe(true)
      expect(backupRoot.startsWith(tmpdir())).toBe(true)
      expect(existsSync(manifestPath)).toBe(true)

      const { getBackupFilePath, getBackup } = await import(
        '../src/backup/index.js'
      )
      const manifest = getBackup(create.data.id)
      const dbPath = getBackupFilePath(manifest!)
      expect(isAbsolute(dbPath)).toBe(true)
      expect(dbPath.startsWith(backupRoot)).toBe(true)
    } finally {
      rmSync(backupRoot, { recursive: true, force: true })
    }
  })

  test('relative BACKUP_DIR resolves under cwd', async () => {
    const relativeDir = './data/backups-test-relative'
    const expected = resolve(process.cwd(), relativeDir)

    process.env.BACKUP_DIR = relativeDir
    const { resetEnvForTests, loadEnv } = await import('../src/env.js')
    resetEnvForTests()
    loadEnv(true)

    const { getBackupDir } = await import('../src/config.js')
    expect(getBackupDir()).toBe(expected)
    expect(isAbsolute(getBackupDir())).toBe(true)
  })
})
