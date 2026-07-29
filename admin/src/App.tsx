import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, authMe, getAdminToken } from './api'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Overview from './pages/Overview'
import Data from './pages/Data'
import Collections from './pages/Collections'
import Logs from './pages/Logs'
import Audit from './pages/Audit'
import Users from './pages/Users'
import Files from './pages/Files'
import Realtime from './pages/Realtime'
import Sql from './pages/Sql'
import Backups from './pages/Backups'
import Settings from './pages/Settings'
import ApiKeys from './pages/ApiKeys'
import System from './pages/System'
import Security from './pages/Security'
import Webhooks from './pages/Webhooks'

function AuthGate() {
  const token = getAdminToken()
  const onboarding = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: () =>
      api<{ data: { needsSetup: boolean } }>('/api/admin/onboarding/status'),
    retry: false,
  })
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authMe,
    retry: false,
    enabled: !onboarding.data?.data.needsSetup,
  })

  if (onboarding.isLoading || me.isLoading) {
    return (
      <div className="login-page">
        <div className="muted">Checking session…</div>
      </div>
    )
  }

  if (onboarding.data?.data.needsSetup) {
    return <Navigate to="/setup" replace />
  }

  const user = me.data?.user
  const isAdmin = user?.role === 'admin' || Boolean(token)
  if (!isAdmin) return <Navigate to="/login" replace />

  return (
    <Layout
      userLabel={
        user?.email || user?.name || (token ? 'Admin token' : undefined)
      }
    />
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<AuthGate />}>
        <Route index element={<Overview />} />
        <Route path="data" element={<Data />} />
        <Route path="data/:table" element={<Data />} />
        <Route path="collections" element={<Collections />} />
        <Route path="logs" element={<Logs />} />
        <Route path="audit" element={<Audit />} />
        <Route path="users" element={<Users />} />
        <Route path="files" element={<Files />} />
        <Route path="realtime" element={<Realtime />} />
        <Route path="sql" element={<Sql />} />
        <Route path="backups" element={<Backups />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="security" element={<Security />} />
        <Route path="system" element={<System />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
