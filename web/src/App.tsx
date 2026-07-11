import { useEffect, useState } from 'react';

type Health = { ok: boolean };

export function App() {
  const [health, setHealth] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject()))
      .then((h) => {
        if (!cancelled) setHealth(h.ok ? 'up' : 'down');
      })
      .catch(() => {
        if (!cancelled) setHealth('down');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 font-sans">
      <h1 className="text-3xl font-semibold">TestHistory</h1>
      <p className="text-sm opacity-70">
        API status:{' '}
        <span data-testid="health">
          {health === 'checking' ? 'checking…' : health === 'up' ? 'up' : 'unreachable'}
        </span>
      </p>
    </main>
  );
}
