import { useEffect, useState } from 'react';
import type { NameRule, NameRulePreviewSample } from '@testhistory/shared';
import { api, ApiError } from '../../api/client.js';
import { Button, Card, ErrorBox, Input, Spinner } from '../../ui.js';

export function NameRulesTab({ projectId }: { projectId: string }) {
  const [rules, setRules] = useState<NameRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [samples, setSamples] = useState<NameRulePreviewSample[] | null>(null);

  useEffect(() => {
    api
      .getNameRules(projectId)
      .then((r) => setRules(r.rules))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Live preview whenever the rules change (debounced).
  useEffect(() => {
    setSaved(false);
    const h = setTimeout(() => {
      api
        .previewNameRules(projectId, rules)
        .then((r) => {
          setSamples(r.samples);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Preview failed.'));
    }, 300);
    return () => clearTimeout(h);
  }, [projectId, rules]);

  const update = (i: number, patch: Partial<NameRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRules((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  async function save() {
    setError(null);
    try {
      await api.putNameRules(projectId, rules);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed.');
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <h3 className="font-medium text-fg">Rules (applied in order to <code>suite::name</code>)</h3>
        {rules.length === 0 && <p className="text-sm text-muted">No rules — test names are taken verbatim.</p>}
        {rules.map((r, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-2">
            <Input placeholder="match (JS regex)" value={r.match} onChange={(e) => update(i, { match: e.target.value })} />
            <Input placeholder="rewrite" value={r.rewrite} onChange={(e) => update(i, { rewrite: e.target.value })} />
            <div className="flex gap-1 text-xs">
              <button className="text-muted hover:text-fg" onClick={() => move(i, -1)}>↑</button>
              <button className="text-muted hover:text-fg" onClick={() => move(i, 1)}>↓</button>
              <button className="ml-auto text-fail hover:underline" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setRules((rs) => [...rs, { match: '', rewrite: '' }])}>
            Add rule
          </Button>
          <Button onClick={save}>Save</Button>
          {saved && <span className="self-center text-sm text-pass">Saved</span>}
        </div>
        {error && <ErrorBox message={error} />}
        <p className="text-xs text-muted">Rules apply to new uploads only; existing tests are not re-merged.</p>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 font-medium text-fg">Preview (recent test names)</h3>
        {!samples && <p className="text-sm text-muted">Upload some runs to preview against real names.</p>}
        {samples && samples.length === 0 && <p className="text-sm text-muted">No test names yet.</p>}
        {samples && samples.length > 0 && (
          <div className="max-h-96 space-y-1 overflow-auto text-sm">
            {samples.map((s, i) => {
              const before = `${s.before.suite}::${s.before.name}`;
              const after = `${s.after.suite}::${s.after.name}`;
              const changed = before !== after;
              return (
                <div key={i} className="font-mono text-xs">
                  <span className="text-muted">{before}</span>
                  {changed && <span className="text-pass"> → {after}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
