import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { requireAuth } from '../auth/middleware.js'
import env from '../env.js'
import { createFileRecord, getFileRecord, deleteFileRecord, listFileRecords } from './meta.js'
import { saveFile, getFile, deleteFile, getFilePath } from './storage.js'

const router = new Hono()

// All file routes require auth
router.use('*', requireAuth)

// POST / — upload file (multipart)
router.post('/', async (c) => {
  const user = c.get('user' as never) as any
  const userId = user?.id

  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No file provided. Use multipart form with "file" field.' } }, 400)
  }

  // Check file size
  if (file.size > env.MAX_FILE_SIZE) {
    return c.json({
      error: { code: 'FILE_TOO_LARGE', message: `File exceeds max size of ${env.MAX_FILE_SIZE} bytes` }
    }, 413)
  }

  const arrayBuffer = await file.arrayBuffer()
  const stored = await saveFile(arrayBuffer, file.name, file.type)

  const record = await createFileRecord({
    filename: stored.filename,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: stored.size,
    storageKey: stored.storageKey,
    uploaderId: userId,
  })

  return c.json({ data: record }, 201)
})

// GET /:id — download/serve file
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const record = await getFileRecord(id)

  if (!record) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  // Check ownership
  const user = c.get('user' as never) as any
  if (record.uploaderId && record.uploaderId !== user?.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not your file' } }, 403)
  }

  const data = await getFile(record.storageKey)
  if (!data) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File data missing from storage' } }, 404)
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': record.mimeType,
      'Content-Length': String(record.size),
      'Content-Disposition': `inline; filename="${record.originalName}"`,
    },
  })
})

// GET / — list user's files
router.get('/', async (c) => {
  const user = c.get('user' as never) as any
  const userId = user?.id
  const page = Number(c.req.query('page') || 1)
  const perPage = Math.min(100, Number(c.req.query('perPage') || 20))

  const { data, total } = await listFileRecords(userId, page, perPage)

  return c.json({
    data,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  })
})

// DELETE /:id — delete file
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const record = await getFileRecord(id)

  if (!record) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }

  // Check ownership
  const user = c.get('user' as never) as any
  if (record.uploaderId && record.uploaderId !== user?.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not your file' } }, 403)
  }

  // Delete from storage + metadata
  await deleteFile(record.storageKey)
  await deleteFileRecord(id)

  return c.json({ data: { id, deleted: true } })
})

export default router
