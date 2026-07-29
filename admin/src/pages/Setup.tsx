import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Setup() {
  const navigate = useNavigate()
  const status = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: () =>
      api<{
        data: {
          needsSetup: boolean
          hasAdmin: boolean
          setupCompleted: boolean
        }
      }>('/api/admin/onboarding/status'),
  })

  const [setupToken, setSetupToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('Admin')
  const [appName, setAppName] = useState('Base')
  const [publicUrl, setPublicUrl] = useState(window.location.origin)
  const [corsOrigins, setCorsOrigins] = useState(window.location.origin)
  const [error, setError] = useState('')

  const issueToken = useMutation({
    mutationFn: () =>
      api<{ data: { issued: boolean; setupToken?: string; message?: string } }>(
        '/api/admin/onboarding/setup-token',
        { method: 'POST', body: '{}' },
      ),
    onSuccess: (res) => {
      if (res.data.setupToken) setSetupToken(res.data.setupToken)
      else setError(res.data.message || 'Token already issued — check server logs')
    },
    onError: (e) => setError((e as Error).message),
  })

  const complete = useMutation({
    mutationFn: () =>
      api('/api/admin/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({
          setupToken,
          email,
          password,
          name,
          appName,
          publicUrl,
          corsOrigins,
        }),
      }),
    onSuccess: () => navigate('/login', { replace: true }),
    onError: (e) => setError((e as Error).message),
  })

  if (status.isLoading) {
    return (
      <div className="login-page">
        <div className="muted">Checking setup…</div>
      </div>
    )
  }

  if (status.data?.data && !status.data.data.needsSetup) {
    navigate('/login', { replace: true })
    return null
  }

  return (
    <div className="login-page">
      <form
        className="login-card"
        style={{ maxWidth: 440 }}
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          complete.mutate()
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.03em' }}>
          Welcome to Base
        </div>
        <p className="muted" style={{ margin: '0.35rem 0 1rem', fontSize: 13 }}>
          Create the first admin and lock down your instance.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <label className="field">
          <span>Setup token</span>
          <input
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            placeholder="From server logs or Issue token"
            required
          />
        </label>
        <button
          type="button"
          className="btn"
          style={{ marginBottom: '0.75rem' }}
          onClick={() => issueToken.mutate()}
        >
          Issue setup token
        </button>

        <label className="field">
          <span>App name</span>
          <input value={appName} onChange={(e) => setAppName(e.target.value)} />
        </label>
        <label className="field">
          <span>Public URL</span>
          <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>CORS origins</span>
          <input
            value={corsOrigins}
            onChange={(e) => setCorsOrigins(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Admin name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Admin email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>

        <button type="submit" className="btn primary" disabled={complete.isPending}>
          {complete.isPending ? 'Creating…' : 'Finish setup'}
        </button>
      </form>
    </div>
  )
}
