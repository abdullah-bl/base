import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  signUpAndIn,
  json,
  type TestContext,
} from './helpers/test-app.js'
import type { ChangeEvent } from '../src/realtime/bus.js'

let ctx: TestContext | undefined

afterEach(() => {
  ctx?.cleanup()
  ctx = undefined
})

interface SseFrame {
  event?: string
  data?: string
  id?: string
}

function parseFrames(buffer: string): {
  frames: SseFrame[]
  rest: string
} {
  const frames: SseFrame[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    if (!part.trim()) continue
    const frame: SseFrame = {}
    const dataLines: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) frame.event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim()
    }
    if (dataLines.length) frame.data = dataLines.join('\n')
    frames.push(frame)
  }
  return { frames, rest }
}

type StreamReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(): Promise<void>
}

async function readUntil(
  reader: StreamReader,
  predicate: (frames: SseFrame[]) => boolean,
  timeoutMs = 3000,
): Promise<SseFrame[]> {
  const decoder = new TextDecoder()
  let buffer = ''
  const collected: SseFrame[] = []
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ])

    if (result.done && !result.value) {
      if (predicate(collected)) return collected
      break
    }
    if (result.done) break

    buffer += decoder.decode(result.value, { stream: true })
    const { frames, rest } = parseFrames(buffer)
    buffer = rest
    collected.push(...frames)
    if (predicate(collected)) return collected
  }

  throw new Error(
    `Timed out waiting for SSE frames. Got: ${JSON.stringify(collected)}`,
  )
}

describe('realtime SSE', () => {
  test('create/update/delete emit change frames', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(ctx.app, 'rt1@example.com')

    const ac = new AbortController()
    const streamRes = await ctx.app.request(
      '/api/realtime?collections=posts',
      { headers: { Cookie: cookie }, signal: ac.signal },
    )
    expect(streamRes.status).toBe(200)
    expect(streamRes.body).toBeTruthy()

    const reader = streamRes.body!.getReader()
    try {
      const opened = await readUntil(reader, (f) =>
        f.some((x) => x.event === 'open'),
      )
      expect(opened.some((x) => x.event === 'open')).toBe(true)

      const createRes = await ctx.app.request('/api/collections/posts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Hello SSE', slug: 'hello-sse' }),
      })
      expect(createRes.status).toBe(201)
      const created = await json<{ data: { id: string } }>(createRes)

      const createFrames = await readUntil(reader, (f) =>
        f.some(
          (x) =>
            x.event === 'change' &&
            x.data &&
            JSON.parse(x.data).action === 'create',
        ),
      )
      const createEvent = JSON.parse(
        createFrames.find((x) => x.event === 'change')!.data!,
      ) as ChangeEvent
      expect(createEvent.action).toBe('create')
      expect(createEvent.recordId).toBe(created.data.id)
      expect(createEvent.collection).toBe('posts')

      const patchRes = await ctx.app.request(
        `/api/collections/posts/${created.data.id}`,
        {
          method: 'PATCH',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Updated SSE' }),
        },
      )
      expect(patchRes.status).toBe(200)

      const updateFrames = await readUntil(reader, (f) =>
        f.some(
          (x) =>
            x.event === 'change' &&
            x.data &&
            JSON.parse(x.data).action === 'update',
        ),
      )
      const updateEvent = JSON.parse(
        updateFrames.find(
          (x) =>
            x.event === 'change' &&
            x.data &&
            JSON.parse(x.data).action === 'update',
        )!.data!,
      ) as ChangeEvent
      expect(updateEvent.action).toBe('update')
      expect((updateEvent.record as { title: string }).title).toBe(
        'Updated SSE',
      )

      const delRes = await ctx.app.request(
        `/api/collections/posts/${created.data.id}`,
        {
          method: 'DELETE',
          headers: { Cookie: cookie },
        },
      )
      expect(delRes.status).toBe(200)

      const deleteFrames = await readUntil(reader, (f) =>
        f.some(
          (x) =>
            x.event === 'change' &&
            x.data &&
            JSON.parse(x.data).action === 'delete',
        ),
      )
      const deleteEvent = JSON.parse(
        deleteFrames.find(
          (x) =>
            x.event === 'change' &&
            x.data &&
            JSON.parse(x.data).action === 'delete',
        )!.data!,
      ) as ChangeEvent
      expect(deleteEvent.action).toBe('delete')
      expect(deleteEvent.recordId).toBe(created.data.id)
    } finally {
      ac.abort()
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    }
  }, 15000)

  test('owner isolation — subscriber does not receive other users records', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, 'owner-a@example.com')
    const b = await signUpAndIn(ctx.app, 'owner-b@example.com')

    const ac = new AbortController()
    const streamRes = await ctx.app.request(
      '/api/realtime?collections=posts',
      { headers: { Cookie: b.cookie }, signal: ac.signal },
    )
    expect(streamRes.status).toBe(200)
    const reader = streamRes.body!.getReader()

    try {
      await readUntil(reader, (f) => f.some((x) => x.event === 'open'))

      // User A creates a post — B must not see it
      const createRes = await ctx.app.request('/api/collections/posts', {
        method: 'POST',
        headers: {
          Cookie: a.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Secret', slug: 'secret-post' }),
      })
      expect(createRes.status).toBe(201)
      const aBody = await json<{ data: { id: string } }>(createRes)

      // Give the bus a tick to fan out (B should filter it out)
      await Bun.sleep(50)

      // B creates their own — should receive only this one
      const own = await ctx.app.request('/api/collections/posts', {
        method: 'POST',
        headers: {
          Cookie: b.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Mine', slug: 'mine-post' }),
      })
      expect(own.status).toBe(201)
      const ownBody = await json<{ data: { id: string } }>(own)

      const frames = await readUntil(reader, (f) =>
        f.some((x) => x.event === 'change'),
      )
      const changeEvents = frames
        .filter((x) => x.event === 'change' && x.data)
        .map((x) => JSON.parse(x.data!) as ChangeEvent)

      expect(changeEvents.some((e) => e.recordId === aBody.data.id)).toBe(false)
      expect(changeEvents.some((e) => e.recordId === ownBody.data.id)).toBe(
        true,
      )
    } finally {
      ac.abort()
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    }
  }, 15000)

  test('anonymous connect to owner-read collection returns 401', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('/api/realtime?collections=posts')
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  test('unknown collection returns 400', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(ctx.app, 'rt-bad@example.com')
    const res = await ctx.app.request(
      '/api/realtime?collections=does_not_exist',
      { headers: { Cookie: cookie } },
    )
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('Last-Event-ID replays missed events from ring buffer', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(ctx.app, 'rt-replay@example.com')

    // First subscription — capture one event id
    const ac1 = new AbortController()
    const stream1 = await ctx.app.request(
      '/api/realtime?collections=posts',
      { headers: { Cookie: cookie }, signal: ac1.signal },
    )
    const reader1 = stream1.body!.getReader()

    let lastId = ''
    try {
      await readUntil(reader1, (f) => f.some((x) => x.event === 'open'))

      const createRes = await ctx.app.request('/api/collections/posts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Replay me', slug: 'replay-me' }),
      })
      expect(createRes.status).toBe(201)
      const created = await json<{ data: { id: string } }>(createRes)

      const frames = await readUntil(reader1, (f) =>
        f.some((x) => x.event === 'change'),
      )
      const change = frames.find((x) => x.event === 'change')!
      lastId = change.id!
      expect(lastId).toBeTruthy()
      expect(JSON.parse(change.data!).recordId).toBe(created.data.id)
    } finally {
      ac1.abort()
      try {
        await reader1.cancel()
      } catch {
        // ignore
      }
    }

    // Create another post while disconnected
    const create2 = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Missed', slug: 'missed-post' }),
    })
    expect(create2.status).toBe(201)
    const missed = await json<{ data: { id: string } }>(create2)

    // Reconnect with Last-Event-ID — should replay the missed create
    const ac2 = new AbortController()
    const stream2 = await ctx.app.request(
      `/api/realtime?collections=posts&lastEventId=${lastId}`,
      {
        headers: {
          Cookie: cookie,
          'Last-Event-ID': lastId,
        },
        signal: ac2.signal,
      },
    )
    const reader2 = stream2.body!.getReader()
    try {
      const frames = await readUntil(
        reader2,
        (f) =>
          f.some(
            (x) =>
              x.event === 'change' &&
              x.data &&
              JSON.parse(x.data).recordId === missed.data.id,
          ),
        5000,
      )
      const replayed = frames
        .filter((x) => x.event === 'change')
        .map((x) => JSON.parse(x.data!) as ChangeEvent)
      expect(
        replayed.some((e) => e.recordId === missed.data.id),
      ).toBe(true)
    } finally {
      ac2.abort()
      try {
        await reader2.cancel()
      } catch {
        // ignore
      }
    }
  }, 15000)
})
