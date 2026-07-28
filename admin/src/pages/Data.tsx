import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { admin } from '../api'

type Col = { name: string; type: string; primaryKey?: boolean }
type RowsRes = {
  columns: Col[]
  data: Record<string, unknown>[]
  meta: { page: number; perPage: number; total: number; totalPages: number }
}

export default function Data() {
  const { table } = useParams()
  const [sp, setSp] = useSearchParams()
  const page = Number(sp.get('page') || 1)
  const search = sp.get('search') || ''
  const [searchInput, setSearchInput] = useState(search)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [draft, setDraft] = useState('')
  const qc = useQueryClient()

  const tables = useQuery({
    queryKey: ['admin', 'data', 'tables'],
    queryFn: () => admin<{ data: string[] }>('/data'),
  })

  const rows = useQuery({
    queryKey: ['admin', 'data', table, page, search],
    enabled: Boolean(table),
    queryFn: () => {
      const q = new URLSearchParams({
        page: String(page),
        perPage: '50',
      })
      if (search) q.set('search', search)
      return admin<RowsRes>(`/data/${table}?${q}`)
    },
  })

  const pk = useMemo(() => {
    const cols = rows.data?.columns || []
    return cols.find((c) => c.primaryKey)?.name || 'id'
  }, [rows.data])

  const save = useMutation({
    mutationFn: async () => {
      if (!table || !editing) return
      const body = JSON.parse(draft) as Record<string, unknown>
      const id = String(editing[pk])
      return admin(`/data/${table}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'data', table] })
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) =>
      admin(`/data/${table}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'data', table] })
    },
  })

  return (
    <div>
      <h1 className="page-title">Data</h1>
      <div className="split">
        <div className="panel" style={{ padding: '0.4rem' }}>
          <div className="muted" style={{ padding: '0.35rem 0.45rem', fontSize: 11 }}>
            Tables
          </div>
          {(tables.data?.data || []).map((t) => (
            <Link
              key={t}
              to={`/data/${t}`}
              className={`nav-link${t === table ? ' active' : ''}`}
            >
              {t}
            </Link>
          ))}
          {tables.isLoading && <div className="muted" style={{ padding: 8 }}>Loading…</div>}
        </div>

        <div>
          {!table && <div className="muted">Select a table</div>}
          {table && (
            <>
              <div className="toolbar">
                <strong className="mono">{table}</strong>
                <input
                  className="input"
                  placeholder="Search…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const next = new URLSearchParams(sp)
                      if (searchInput) next.set('search', searchInput)
                      else next.delete('search')
                      next.set('page', '1')
                      setSp(next)
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const next = new URLSearchParams(sp)
                    if (searchInput) next.set('search', searchInput)
                    else next.delete('search')
                    next.set('page', '1')
                    setSp(next)
                  }}
                >
                  Search
                </button>
                <span className="muted">
                  {rows.data?.meta.total ?? '—'} rows
                </span>
              </div>
              {rows.error && (
                <div className="error-banner">{(rows.error as Error).message}</div>
              )}
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      {(rows.data?.columns || []).map((c) => (
                        <th key={c.name}>{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(rows.data?.data || []).map((row, i) => (
                      <tr
                        key={String(row[pk] ?? i)}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setEditing(row)
                          setDraft(JSON.stringify(row, null, 2))
                        }}
                      >
                        {(rows.data?.columns || []).map((c) => (
                          <td key={c.name} className="mono" title={String(row[c.name] ?? '')}>
                            {row[c.name] == null ? 'null' : String(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!rows.isLoading && (rows.data?.data.length || 0) === 0 && (
                      <tr>
                        <td className="muted" colSpan={rows.data?.columns.length || 1}>
                          No rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={page <= 1}
                  onClick={() => {
                    const next = new URLSearchParams(sp)
                    next.set('page', String(page - 1))
                    setSp(next)
                  }}
                >
                  Prev
                </button>
                <span className="muted">
                  Page {page}
                  {rows.data ? ` / ${rows.data.meta.totalPages || 1}` : ''}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={!rows.data || page >= rows.data.meta.totalPages}
                  onClick={() => {
                    const next = new URLSearchParams(sp)
                    next.set('page', String(page + 1))
                    setSp(next)
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {editing && (
        <>
          <div className="drawer-backdrop" onClick={() => setEditing(null)} />
          <div className="drawer">
            <div className="toolbar">
              <strong>Edit row</strong>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
            <textarea
              className="textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ minHeight: '16rem' }}
            />
            {save.error && (
              <div className="error-banner">{(save.error as Error).message}</div>
            )}
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-primary"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm('Delete this row?')) {
                    remove.mutate(String(editing[pk]))
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
