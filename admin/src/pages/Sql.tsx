import { useState } from 'react'
import { admin } from '../api'

type SqlResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowsAffected?: number
  durationMs: number
  readonly: boolean
}

export default function Sql() {
  const [sql, setSql] = useState('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<SqlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await admin<{ data: SqlResult }>('/sql', {
        method: 'POST',
        body: JSON.stringify({ sql, confirm }),
      })
      setResult(res.data)
    } catch (err) {
      setResult(null)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">SQL</h1>
      <textarea
        className="textarea"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
      />
      <div className="toolbar">
        <label className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          Confirm write
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !sql.trim()}
          onClick={() => void run()}
        >
          Run
        </button>
        {result && (
          <span className="muted">
            {result.durationMs}ms
            {result.readonly ? '' : ` · ${result.rowsAffected ?? 0} affected`}
            {` · ${result.rows.length} rows`}
          </span>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {result && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => (
                    <td key={c} className="mono" title={String(row[c] ?? '')}>
                      {row[c] == null ? 'null' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {result.rows.length === 0 && (
                <tr>
                  <td className="muted" colSpan={Math.max(result.columns.length, 1)}>
                    No rows returned
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
