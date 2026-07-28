import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, formatTs } from '../api'

type User = {
  id: string
  name?: string
  email?: string
  role?: string
  emailVerified?: boolean
  createdAt?: number
  updatedAt?: number
}

export default function Users() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['admin', 'users', q, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        perPage: '50',
      })
      if (q) params.set('search', q)
      return admin<{ data: User[]; meta: { total: number } }>(`/users?${params}`)
    },
  })

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'user' }) =>
      admin(`/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      admin(`/users/${id}/sessions`, { method: 'DELETE' }),
  })

  const del = useMutation({
    mutationFn: (id: string) => admin(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  return (
    <div>
      <h1 className="page-title">Users</h1>
      <div className="toolbar">
        <input
          className="input"
          placeholder="Search email or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setQ(search)
              setPage(1)
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setQ(search)
            setPage(1)
          }}
        >
          Search
        </button>
        <span className="muted">{list.data?.meta.total ?? '—'} users</span>
      </div>
      {(list.error || setRole.error || del.error) && (
        <div className="error-banner">
          {(
            (list.error || setRole.error || del.error) as Error
          ).message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((u) => (
              <tr key={u.id}>
                <td>{u.email || '—'}</td>
                <td>{u.name || '—'}</td>
                <td>
                  <select
                    className="select"
                    value={u.role || 'user'}
                    onChange={(e) =>
                      setRole.mutate({
                        id: u.id,
                        role: e.target.value as 'admin' | 'user',
                      })
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="mono">{formatTs(u.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => revoke.mutate(u.id)}
                  >
                    Revoke sessions
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (confirm(`Delete user ${u.email}?`)) del.mutate(u.id)
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
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Prev
        </button>
        <span className="muted">Page {page}</span>
        <button
          type="button"
          className="btn"
          disabled={(list.data?.data.length || 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
