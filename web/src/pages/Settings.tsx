import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ProjectInfo } from '@testhistory/shared';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { useAuth } from '../auth/AuthContext.js';
import { ErrorBox, Spinner } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';
import { TokensTab } from '../components/settings/TokensTab.js';
import { PluginsTab } from '../components/settings/PluginsTab.js';
import { MembersTab } from '../components/settings/MembersTab.js';
import { NameRulesTab } from '../components/settings/NameRulesTab.js';
import { DangerTab } from '../components/settings/DangerTab.js';

type TabId = 'tokens' | 'plugins' | 'members' | 'name-rules' | 'danger';

export function SettingsPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const project = useAsync(() => api.getProject(id), [id]);
  const [tab, setTab] = useState<TabId>('tokens');
  const navigate = useNavigate();

  const p = project.data?.project;
  const isOwner = useMemo(() => !!p && (p.myRole === 'owner' || user?.role === 'admin'), [p, user]);
  const isMember = useMemo(() => !!p && (p.myRole !== null || user?.role === 'admin'), [p, user]);

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!p) return null;

  if (!isMember) {
    return (
      <div className="space-y-6">
        <ProjectNav project={p} />
        <ErrorBox message="You don't have permission to manage this project." />
      </div>
    );
  }

  const allTabs: { id: TabId; label: string; ownerOnly?: boolean }[] = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'members', label: 'Members', ownerOnly: true },
    { id: 'name-rules', label: 'Name Rules' },
    { id: 'danger', label: 'Danger', ownerOnly: true },
  ];
  const tabs = allTabs.filter((t) => !t.ownerOnly || isOwner);

  return (
    <div className="space-y-6">
      <ProjectNav project={p} />
      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tokens' && <TokensTab projectId={id} />}
      {tab === 'plugins' && <PluginsTab projectId={id} />}
      {tab === 'members' && isOwner && <MembersTab projectId={id} />}
      {tab === 'name-rules' && <NameRulesTab projectId={id} />}
      {tab === 'danger' && isOwner && (
        <DangerTab project={p} onDeleted={() => navigate('/')} onChanged={() => project.reload()} />
      )}
    </div>
  );
}

export type { ProjectInfo };
