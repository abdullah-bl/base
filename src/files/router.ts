import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import env from '../env.js'
import {
  createFileRecord,
  getFileRecord,
  deleteFileRecord,
  listFileRecords,
} from './meta.js'
import { saveFile, deleteFile, getStorageDriver } from './storage.js'

const router = new Hono()

router.use('*', requireAuth)

/** Sanitize originalName for Content-Disposition */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\r\n"\\]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .slice(0, 200) || 'download'
}

router.post('/', async (c) => {
  const user = c.get('user' as never) as any
  const userId = user?.id as string | undefined

  if (!userId) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401,
    )
  }

  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No file provided. Use multipart form with "file" field.',
        },
      },
      400,
    )
  }

  if (file.size > env.MAX_FILE_SIZE) {
    return c.json(
      {
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds max size of ${env.MAX_FILE_SIZE} bytes`,
        },
      },
      413,
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const stored = await saveFile(arrayBuffer, file.name, file.type)

  try {
    const record = await createFileRecord({
      filename: stored.filename,
      originalName: sanitizeFilename(file.name),
      mimeType: file.type || 'application/octet-stream',
      size: stored.size,
      storageKey: stored.storageKey,
      uploaderId: userId,
    })
    return c.json({ data: record }, 201)
  } catch (err) {
    // Compensating delete if metadata insert fails
    await deleteFile(stored.storageKey)
    throw err
  }
})

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const record = await getFileRecord(id)

  if (!record) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'File not found' } },
      404,
    )
  }

  const user = c.get('user' as never) as any
  // Deny when uploaderId is null or does not match
  if (!record.uploaderId || record.uploaderId !== user?.id) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Not your file' } },
      403,
    )
  }

  const safeName = sanitizeFilename(record.originalName)
  const result = await getStorageDriver().download(
    record.storageKey,
    record.mimeType,
  )
  if (!result) {
    return c.json(
      {
        error: { code: 'NOT_FOUND', message: 'File data missing from storage' },
      },
      404,
    )
  }

  if (result.kind === 'redirect') {
    return c.redirect(result.url, 302)
  }

  return new Response(result.body, {
    headers: {
      'Content-Type': record.mimeType,
      'Content-Length': String(record.size),
      'Content-Disposition': `inline; filename="${safeName}"`,
    },
  })
})

router.get('/', async (c) => {
  const user = c.get('user' as never) as any
  const userId = user?.id
  if (!userId) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401,
    )
  }
  const page = Number(c.req.query('page') || 1)
  const perPage = Math.min(100, Number(c.req.query('perPage') || 20))

  const { data, total } = await listFileRecords(userId, page, perPage)

  return c.json({
    data,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) || 0 },
  })
})

router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const record = await getFileRecord(id)

  if (!record) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'File not found' } },
      404,
    )
  }

  const user = c.get('user' as never) as any
  if (!record.uploaderId || record.uploaderId !== user?.id) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Not your file' } },
      403,
    )
  }

  // Delete metadata first, then storage (compensating restore not needed for files)
  await deleteFileRecord(id)
  await deleteFile(record.storageKey)

  return c.json({ data: { id, deleted: true } })
})

export default router
