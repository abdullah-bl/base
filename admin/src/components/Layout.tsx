import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getAdminToken, setAdminToken, signOut } from '../api'
import { CommandPalette } from './CommandPalette'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/data', label: 'Data' },
  { to: '/collections', label: 'Collections' },
  { to: '/logs', label: 'Logs' },
  { to: '/audit', label: 'Audit' },
  { to: '/users', label: 'Users' },
  { to: '/files', label: 'Files' },
  { to: '/realtime', label: 'Realtime' },
  { to: '/sql', label: 'SQL' },
  { to: '/backups', label: 'Backups' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/settings', label: 'Settings' },
] as const

export function Layout({
  userLabel,
}: {
  userLabel?: string
}) {
  const navigate = useNavigate()

  async function logout() {
    setAdminToken(null)
    await signOut()
    navigate('/login', { replace: true })
    window.location.reload()
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div style={{ padding: '0.35rem 0.55rem 0.75rem' }}>
          <div style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>Base</div>
          <div className="faint" style={{ fontSize: 11 }}>
            Admin
          </div>
        </div>
        <nav style={{ display: 'grid', gap: 2 }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                `nav-link${isActive ? ' active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: '1.25rem', padding: '0.55rem' }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            {userLabel || (getAdminToken() ? 'token auth' : '—')}
          </div>
          <button type="button" className="btn" style={{ width: '100%' }} onClick={() => logout()}>
            Sign out
          </button>
          <div className="faint" style={{ marginTop: 8, fontSize: 11 }}>
            <kbd className="kbd">⌘K</kbd> / <kbd className="kbd">Ctrl+K</kbd>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  )
}
