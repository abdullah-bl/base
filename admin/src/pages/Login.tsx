import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authMe, getAdminToken, setAdminToken, signInEmail } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(getAdminToken() || '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onboarding = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: () =>
      api<{ data: { needsSetup: boolean } }>('/api/admin/onboarding/status'),
    retry: false,
  })

  const providers = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () =>
      api<{ data: Array<{ id: string; name: string }> }>('/api/auth/providers'),
    retry: false,
  })

  useEffect(() => {
    if (onboarding.data?.data.needsSetup) {
      navigate('/setup', { replace: true })
    }
  }, [onboarding.data, navigate])

  useEffect(() => {
    void (async () => {
      const me = await authMe().catch(() => null)
      if (me?.user?.role === 'admin' || getAdminToken()) {
        navigate('/', { replace: true })
      }
    })()
  }, [navigate])

  async function afterAuth() {
    await qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    const me = await authMe()
    const hasToken = Boolean(getAdminToken())
    if (me?.user?.role === 'admin' || hasToken) {
      navigate('/', { replace: true })
    } else {
      setError('Signed in, but this account is not an admin')
    }
  }

  async function onEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInEmail(email.trim(), password)
      await afterAuth()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onToken(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const t = token.trim()
      if (!t) {
        setError('Token is required')
        return
      }
      setAdminToken(t)
      const probe = await fetch('/api/admin/overview', {
        credentials: 'include',
        headers: { 'X-Admin-Token': t },
      })
      if (!probe.ok) {
        setAdminToken(null)
        const body = await probe.json().catch(() => null)
        throw new Error(body?.error?.message || 'Invalid admin token')
      }
      await afterAuth()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>Base</h1>
        <p className="muted" style={{ margin: '0 0 1.25rem' }}>
          Admin access
        </p>
        {error && <div className="error-banner">{error}</div>}

        {(providers.data?.data || []).length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
            {providers.data!.data.map((p) => (
              <a
                key={p.id}
                className="btn"
                style={{ textAlign: 'center' }}
                href={`/api/auth/sign-in/social?provider=${p.id}`}
              >
                Continue with {p.name}
              </a>
            ))}
          </div>
        )}

        <form onSubmit={onEmailSignIn}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: '100%' }}
          >
            Sign in
          </button>
        </form>

        <div
          className="faint"
          style={{ margin: '1.25rem 0 0.75rem', textAlign: 'center' }}
        >
          or use ADMIN_TOKEN
        </div>

        <form onSubmit={onToken}>
          <div className="field">
            <label htmlFor="token">Admin token</label>
            <input
              id="token"
              className="input mono"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste ADMIN_TOKEN"
            />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={busy}
            style={{ width: '100%' }}
          >
            Continue with token
          </button>
        </form>

        <p className="faint" style={{ marginTop: '1rem', fontSize: 12 }}>
          First time? <Link to="/setup">Run setup</Link>
        </p>
      </div>
    </div>
  )
}
