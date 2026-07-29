import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin } from '../api'

type Webhook = {
  id: string
  url: string
  secret?: string | null
  collections: string[]
  enabled: boolean
  createdAt: number
}

export default function Webhooks() {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [collections, setCollections] = useState('*')

  const list = useQuery({
    queryKey: ['admin', 'webhooks'],
    queryFn: () => admin<{ data: Webhook[] }>('/webhooks'),
  })

  const create = useMutation({
    mutationFn: () =>
      admin('/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url,
          secret: secret || undefined,
          collections: collections
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: () => {
      setUrl('')
      setSecret('')
      qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] })
    },
  })

  const del = useMutation({
    mutationFn: (id: string) =>
      admin(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] }),
  })

  return (
    <div>
      <h1 className="page-title">Webhooks</h1>
      <section className="panel" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 14, margin: '0 0 0.75rem' }}>Register webhook</h2>
        <label className="field">
          <span>URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          <span>Secret (optional)</span>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <label className="field">
          <span>Collections (comma-separated, or *)</span>
          <input value={collections} onChange={(e) => setCollections(e.target.value)} />
        </label>
        {create.error && (
          <div className="error-banner">{(create.error as Error).message}</div>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={!url || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </button>
      </section>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>URL</th>
              <th>Collections</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((w) => (
              <tr key={w.id}>
                <td className="mono">{w.url}</td>
                <td className="mono">{(w.collections || []).join(', ')}</td>
                <td>{w.enabled ? 'yes' : 'no'}</td>
                <td>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      if (confirm('Delete webhook?')) del.mutate(w.id)
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
