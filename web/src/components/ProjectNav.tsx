import { NavLink } from 'react-router-dom';
import type { ProjectInfo } from '@testhistory/shared';

const tab = 'rounded-md px-3 py-1.5 text-sm';
const active = 'bg-primary text-primary-fg';
const idle = 'text-muted hover:bg-surface-2';

export function ProjectNav({ project }: { project: ProjectInfo }) {
  const base = `/projects/${project.id}`;
  const canManage = project.myRole !== null; // members/owners; admins see it too via API
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-fg">{project.name}</h1>
          {project.private && <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">Private</span>}
        </div>
        {project.description && <p className="mt-1 text-sm text-muted">{project.description}</p>}
      </div>
      <nav className="flex gap-1">
        <NavLink end to={base} className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
          Overview
        </NavLink>
        <NavLink to={`${base}/flaky`} className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
          Flaky
        </NavLink>
        {canManage && (
          <NavLink to={`${base}/settings`} className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
            Settings
          </NavLink>
        )}
      </nav>
    </div>
  );
}
