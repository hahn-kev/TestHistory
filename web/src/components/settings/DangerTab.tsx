import { useState } from 'react';
import type { ProjectInfo } from '@testhistory/shared';
import { api, ApiError } from '../../api/client.js';
import { Button, Card, ErrorBox, Field, Input } from '../../ui.js';

export function DangerTab({
  project,
  onDeleted,
  onChanged,
}: {
  project: ProjectInfo;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [isPrivate, setIsPrivate] = useState(project.private);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(patch: Parameters<typeof api.updateProject>[1]) {
    setError(null);
    setSaved(false);
    try {
      await api.updateProject(project.id, patch);
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed.');
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="font-medium text-fg">Details</h3>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Button onClick={() => save({ name, description: description || null })}>Save details</Button>
        {saved && <span className="ml-2 text-sm text-pass">Saved</span>}
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="font-medium text-fg">Visibility</h3>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => {
              setIsPrivate(e.target.checked);
              void save({ private: e.target.checked });
            }}
          />
          Private (visible to members and admins only)
        </label>
      </Card>

      <Card className="space-y-2 border-fail/40 p-4">
        <h3 className="font-medium text-fail">Delete project</h3>
        <p className="text-sm text-muted">Permanently removes the project, its database, runs, and plugins.</p>
        <Button
          variant="danger"
          onClick={async () => {
            if (prompt(`Type the project name "${project.name}" to confirm deletion.`) === project.name) {
              try {
                await api.deleteProject(project.id);
                onDeleted();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Delete failed.');
              }
            }
          }}
        >
          Delete this project
        </Button>
      </Card>

      {error && <ErrorBox message={error} />}
    </div>
  );
}
