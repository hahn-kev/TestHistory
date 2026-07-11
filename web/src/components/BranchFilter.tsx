import { Input } from '../ui.js';

/** Branch filter shared by the overview and flaky pages. Empty = all branches. */
export function BranchFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Branch</span>
      <Input
        placeholder="all branches"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-48"
      />
    </div>
  );
}
