import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { admin, formatBytes, formatTs, getAdminToken } from '../api'

type Backup = {
  id: string
  createdAt?: number
  dbFile?: string
  size?: number
  includeUploads?: boolean
  [key: string]: unknown
}

export default function Backups() {
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => admin<{ data: Backup[] }>('/backups'),
  })

  const create = useMutation({
    mutationFn: () =>
      admin('/backups', {
        method: 'POST',
        body: JSON.stringify({ includeUploads: true }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'backups'] }),
  })

  const restore = useMutation({
    mutationFn: (id: string) =>
      admin(`/backups/${id}/restore`, { method: 'POST', body: '{}' }),
  })

  const del = useMutation({
    mutationFn: (id: string) => admin(`/backups/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'backups'] }),
  })

  function download(id: string) {
    const token = getAdminToken()
    const a = document.createElement('a')
    a.href = `/api/admin/backups/${id}/download`
    // cookie auth works via navigation; token via fetch blob
    if (token) {
      void fetch(`/api/admin/backups/${id}/download`, {
        credentials: 'include',
        headers: { 'X-Admin-Token': token },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Download failed')
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          a.href = url
          a.download = `backup-${id}.db`
          a.click()
          URL.revokeObjectURL(url)
        })
        .catch((err) => alert((err as Error).message))
    } else {
      a.click()
    }
  }

  return (
    <div>
      <h1 className="page-title">Backups</h1>
      <div className="toolbar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create backup
        </button>
      </div>
      {(list.error || create.error || restore.error || del.error) && (
        <div className="error-banner">
          {(
            (list.error || create.error || restore.error || del.error) as Error
          ).message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>ID</th>
              <th>Created</th>
              <th>Size</th>
              <th>Uploads</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td className="mono">{formatTs(b.createdAt)}</td>
                <td className="mono">{formatBytes(b.size as number | undefined)}</td>
                <td>{b.includeUploads ? 'yes' : 'no'}</td>
                <td>
                  <button type="button" className="btn" onClick={() => download(b.id)}>
                    Download
                  </button>{' '}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (confirm('Restore this backup? This replaces the database.')) {
                        restore.mutate(b.id)
                      }
                    }}
                  >
                    Restore
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (confirm('Delete backup?')) del.mutate(b.id)
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
                  No backups
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
