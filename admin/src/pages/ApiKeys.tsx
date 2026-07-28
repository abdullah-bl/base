import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, formatTs } from '../api'

type ApiKey = {
  id: string
  name: string
  keyPrefix?: string
  scopes?: string[]
  createdAt?: number
  expiresAt?: number | null
  revokedAt?: number | null
  lastUsedAt?: number | null
}

export default function ApiKeys() {
  const [name, setName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['admin', 'api-keys'],
    queryFn: () => admin<{ data: ApiKey[] }>('/api-keys'),
  })

  const create = useMutation({
    mutationFn: () =>
      admin<{ data: ApiKey & { key: string } }>('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes: ['*'] }),
      }),
    onSuccess: (res) => {
      setCreatedKey(res.data.key)
      setName('')
      void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      admin(`/api-keys/${id}/revoke`, { method: 'POST', body: '{}' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] }),
  })

  const del = useMutation({
    mutationFn: (id: string) => admin(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] }),
  })

  return (
    <div>
      <h1 className="page-title">API Keys</h1>
      <div className="toolbar">
        <input
          className="input"
          placeholder="Key name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </button>
      </div>
      {createdKey && (
        <div className="panel" style={{ marginBottom: '0.75rem' }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Copy now — shown once
          </div>
          <code className="mono">{createdKey}</code>
        </div>
      )}
      {(list.error || create.error || revoke.error || del.error) && (
        <div className="error-banner">
          {(
            (list.error || create.error || revoke.error || del.error) as Error
          ).message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Revoked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.keyPrefix || '—'}</td>
                <td className="mono">{formatTs(k.createdAt)}</td>
                <td className="mono">{formatTs(k.revokedAt)}</td>
                <td>
                  {!k.revokedAt && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => revoke.mutate(k.id)}
                    >
                      Revoke
                    </button>
                  )}{' '}
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (confirm('Delete API key?')) del.mutate(k.id)
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!list.isLoading && (list.data?.data.length || 0) === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No API keys
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
