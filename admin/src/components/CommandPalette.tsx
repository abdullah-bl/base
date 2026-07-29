import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const ROUTES = [
  { path: '/', label: 'Overview' },
  { path: '/data', label: 'Data' },
  { path: '/collections', label: 'Collections' },
  { path: '/logs', label: 'Logs' },
  { path: '/audit', label: 'Audit' },
  { path: '/users', label: 'Users' },
  { path: '/files', label: 'Files' },
  { path: '/webhooks', label: 'Webhooks' },
  { path: '/realtime', label: 'Realtime' },
  { path: '/sql', label: 'SQL' },
  { path: '/backups', label: 'Backups' },
  { path: '/api-keys', label: 'API Keys' },
  { path: '/security', label: 'Security' },
  { path: '/system', label: 'System' },
  { path: '/settings', label: 'Settings' },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const navigate = useNavigate()

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return ROUTES
    return ROUTES.filter(
      (r) =>
        r.label.toLowerCase().includes(needle) ||
        r.path.toLowerCase().includes(needle),
    )
  }, [q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQ('')
        setIdx(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setIdx(0)
  }, [q])

  if (!open) return null

  function go(path: string) {
    navigate(path)
    setOpen(false)
  }

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Go to…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(i + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter' && items[idx]) {
              e.preventDefault()
              go(items[idx].path)
            }
          }}
        />
        <div className="palette-list">
          {items.length === 0 && (
            <div className="muted" style={{ padding: '0.6rem' }}>
              No matches
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={item.path}
              type="button"
              className={`palette-item${i === idx ? ' active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(item.path)}
            >
              <span>{item.label}</span>
              <span className="faint mono" style={{ float: 'right' }}>
                {item.path}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
