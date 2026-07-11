import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { AppShell } from './components/AppShell.js';
import { Spinner } from './ui.js';
import { LoginPage } from './pages/Login.js';
import { SetupPage } from './pages/Setup.js';
import { DashboardPage } from './pages/Dashboard.js';
import { ProjectOverviewPage } from './pages/ProjectOverview.js';
import { RunDetailPage } from './pages/RunDetail.js';
import { TestDetailPage } from './pages/TestDetail.js';
import { FlakyPage } from './pages/Flaky.js';
import { SettingsPage } from './pages/Settings.js';
import { PluginHostPage } from './pages/PluginHostPage.js';
import { AdminUsersPage } from './pages/AdminUsers.js';

/** Gate authenticated routes: loader hits /api/auth/me (via AuthProvider); 401 → /login. */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/projects/:id', element: <ProjectOverviewPage /> },
      { path: '/projects/:id/runs/:runId', element: <RunDetailPage /> },
      { path: '/projects/:id/tests/:testId', element: <TestDetailPage /> },
      { path: '/projects/:id/flaky', element: <FlakyPage /> },
      { path: '/projects/:id/settings', element: <SettingsPage /> },
      { path: '/projects/:id/plugins/:pluginId', element: <PluginHostPage /> },
      {
        element: <RequireAdmin />,
        children: [{ path: '/admin/users', element: <AdminUsersPage /> }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
