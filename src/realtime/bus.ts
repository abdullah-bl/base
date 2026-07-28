import { ulid } from 'ulid'
import type { CollectionSchema } from '../schema/types.js'
import {
  canReadRecord,
  type AuthUser,
} from '../collections/access.js'
import env from '../env.js'

export type ChangeAction = 'create' | 'update' | 'delete'

export interface ChangeEvent {
  /** ULID — monotonic, doubles as SSE event id */
  id: string
  collection: string
  action: ChangeAction
  recordId: string
  /** Post-state; pre-delete state for 'delete' */
  record: Record<string, unknown>
  ts: number
}

export interface Subscriber {
  id: string
  collections: Set<string>
  user: AuthUser | null
  onEvent: (event: ChangeEvent) => void
  /** Called when the bus is shut down */
  onClose?: () => void
}

const subscribers = new Set<Subscriber>()
const ringBuffer: ChangeEvent[] = []

function replayBufferSize(): number {
  const n = env.REALTIME_REPLAY_BUFFER
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100
}

function pushRing(event: ChangeEvent): void {
  ringBuffer.push(event)
  const max = replayBufferSize()
  while (ringBuffer.length > max) {
    ringBuffer.shift()
  }
}

/**
 * Publish a collection change. Never throws into the caller —
 * a bad subscriber cannot fail a write.
 */
export function publishChange(
  collection: CollectionSchema,
  action: ChangeAction,
  record: Record<string, unknown>,
): void {
  if (!env.REALTIME_ENABLED) return

  const recordId = String(record.id ?? '')
  if (!recordId) return

  const event: ChangeEvent = {
    id: ulid(),
    collection: collection.name,
    action,
    recordId,
    record,
    ts: Date.now(),
  }

  pushRing(event)

  for (const sub of subscribers) {
    if (!sub.collections.has(collection.name)) continue
    try {
      if (!canReadRecord(collection, sub.user, record)) continue
      sub.onEvent(event)
    } catch {
      // Never let a subscriber break the publisher
    }
  }

  // Fire-and-forget outbound webhooks
  void import('../webhooks/index.js')
    .then(({ dispatchWebhooks }) => {
      dispatchWebhooks(event)
    })
    .catch(() => {
      // ignore
    })
}

export interface SubscribeOptions {
  collections: string[]
  user: AuthUser | null
  onEvent: (event: ChangeEvent) => void
  onClose?: () => void
  /** Replay events with id > lastEventId from the ring buffer */
  lastEventId?: string
  /** Resolve a collection schema by name (for access filtering on replay) */
  resolveCollection: (name: string) => CollectionSchema | undefined
}

/**
 * Subscribe to change events. Returns an unsubscribe function.
 */
export function subscribe(opts: SubscribeOptions): () => void {
  const sub: Subscriber = {
    id: ulid(),
    collections: new Set(opts.collections),
    user: opts.user,
    onEvent: opts.onEvent,
    onClose: opts.onClose,
  }

  subscribers.add(sub)

  // Replay missed events from the ring buffer
  if (opts.lastEventId) {
    for (const event of ringBuffer) {
      if (event.id <= opts.lastEventId) continue
      if (!sub.collections.has(event.collection)) continue
      const collection = opts.resolveCollection(event.collection)
      if (!collection) continue
      try {
        if (!canReadRecord(collection, sub.user, event.record)) continue
        sub.onEvent(event)
      } catch {
        // ignore
      }
    }
  }

  return () => {
    subscribers.delete(sub)
  }
}

/** Close all subscribers (e.g. on SIGTERM). */
export function closeAllForShutdown(): void {
  for (const sub of subscribers) {
    try {
      sub.onClose?.()
    } catch {
      // ignore
    }
  }
  subscribers.clear()
}

/** Reset bus state — for tests only. */
export function resetBusForTests(): void {
  subscribers.clear()
  ringBuffer.length = 0
}

/** Inspect ring buffer — for tests only. */
export function getRingBufferForTests(): readonly ChangeEvent[] {
  return ringBuffer
}

/** Inspect subscriber count — for tests only. */
export function getSubscriberCountForTests(): number {
  return subscribers.size
}

export function getSubscriberCount(): number {
  return subscribers.size
}

export function getRecentEvents(limit = 50): ChangeEvent[] {
  return ringBuffer.slice(-limit)
}
