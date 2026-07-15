import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { ThemeSwitcher } from '../theme/ThemeSwitcher.js';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-full">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold text-fg">
            Test<span className="text-primary">History</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            {user?.role === 'admin' && (
              <Link to="/admin/users" className="text-sm text-muted hover:text-fg">
                Admin
              </Link>
            )}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
                >
                  {user.displayName}
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
                    <div className="px-3 py-1.5 text-xs text-muted">{user.email}</div>
                    <button
                      className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
                      onClick={async () => {
                        await logout();
                        navigate('/login');
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
