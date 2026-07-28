import { ulid } from 'ulid'
import { getClient } from '../db/client.js'

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  const client = getClient()
  await client.execute(`CREATE TABLE IF NOT EXISTS "files" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploaderId" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" INTEGER NOT NULL DEFAULT 0
  )`)
  tableEnsured = true
}

export function resetFilesTableCache(): void {
  tableEnsured = false
}

export interface FileRecord {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  storageKey: string
  uploaderId: string | null
  createdAt: number
  updatedAt: number
}

export async function createFileRecord(data: {
  filename: string
  originalName: string
  mimeType: string
  size: number
  storageKey: string
  uploaderId: string
}): Promise<FileRecord> {
  await ensureTable()
  const client = getClient()
  const now = Date.now()
  const id = ulid()

  await client.execute({
    sql: `INSERT INTO "files" ("id", "filename", "originalName", "mimeType", "size", "storageKey", "uploaderId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      data.filename,
      data.originalName,
      data.mimeType,
      data.size,
      data.storageKey,
      data.uploaderId,
      now,
      now,
    ],
  })

  return {
    id,
    ...data,
    uploaderId: data.uploaderId,
    createdAt: now,
    updatedAt: now,
  }
}

export async function getFileRecord(id: string): Promise<FileRecord | null> {
  await ensureTable()
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "files" WHERE "id" = ? LIMIT 1`,
    args: [id],
  })

  if (!result.rows || result.rows.length === 0) return null
  return result.rows[0] as unknown as FileRecord
}

export async function deleteFileRecord(id: string): Promise<boolean> {
  await ensureTable()
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "files" WHERE "id" = ?`,
    args: [id],
  })
  return (result.rowsAffected || 0) > 0
}

export async function listFileRecords(
  uploaderId: string,
  page = 1,
  perPage = 20,
): Promise<{ data: FileRecord[]; total: number }> {
  await ensureTable()
  const client = getClient()
  const offset = (page - 1) * perPage

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as total FROM "files" WHERE "uploaderId" = ?`,
    args: [uploaderId],
  })
  const total = Number(countResult.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "files" WHERE "uploaderId" = ? ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`,
    args: [uploaderId, perPage, offset],
  })

  return {
    data: (result.rows || []) as unknown as FileRecord[],
    total,
  }
}

export async function listAllFileRecords(
  page = 1,
  perPage = 50,
): Promise<{
  data: FileRecord[]
  meta: { page: number; perPage: number; total: number }
}> {
  await ensureTable()
  const client = getClient()
  const offset = (page - 1) * perPage

  const countResult = await client.execute(
    `SELECT COUNT(*) as total FROM "files"`,
  )
  const total = Number(countResult.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "files" ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`,
    args: [perPage, offset],
  })

  return {
    data: (result.rows || []) as unknown as FileRecord[],
    meta: { page, perPage, total },
  }
}
