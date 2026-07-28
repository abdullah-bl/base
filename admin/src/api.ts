const TOKEN_KEY = 'base.adminToken'

export type ApiError = { error: { code: string; message: string } }

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAdminToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

function headers(init?: HeadersInit, json = true): Headers {
  const h = new Headers(init)
  if (json && !h.has('Content-Type')) h.set('Content-Type', 'application/json')
  const token = getAdminToken()
  if (token) h.set('X-Admin-Token', token)
  return h
}

export class AdminApiError extends Error {
  status: number
  code: string
  constructor(status: number, body: ApiError | unknown) {
    const err = (body as ApiError)?.error
    super(err?.message || `Request failed (${status})`)
    this.status = status
    this.code = err?.code || 'REQUEST_FAILED'
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new AdminApiError(res.status, body)
  return body as T
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: headers(init.headers, init.body !== undefined),
  })
  return parse<T>(res)
}

export async function admin<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return api<T>(`/api/admin${path}`, init)
}

export async function authMe(): Promise<{ user: { id: string; email?: string; name?: string; role?: string } } | null> {
  try {
    return await api('/api/auth/me')
  } catch (err) {
    if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) {
      return null
    }
    throw err
  }
}

export async function signInEmail(email: string, password: string) {
  return api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function signOut() {
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' })
  } catch {
    // ignore
  }
}

/** Fetch-based SSE (supports X-Admin-Token; EventSource cannot). */
export function streamAdminLogs(
  onEvent: (entry: unknown) => void,
  onError?: (err: unknown) => void,
): () => void {
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const res = await fetch('/api/admin/logs/stream', {
        credentials: 'include',
        headers: headers(undefined, false),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        throw new AdminApiError(res.status, await res.json().catch(() => null))
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const block of parts) {
          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (event === 'log' && data) {
            try {
              onEvent(JSON.parse(data))
            } catch {
              onEvent(data)
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      onError?.(err)
    }
  })()
  return () => ctrl.abort()
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function formatTs(ts: number | string | null | undefined): string {
  if (ts == null || ts === '') return '—'
  const n = typeof ts === 'string' ? Number(ts) : ts
  if (!Number.isFinite(n)) return String(ts)
  return new Date(n).toLocaleString()
}
