import type { Database as Db } from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProjectRole } from '@testhistory/shared';
import { sendError } from './guards.js';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  private: number;
  created_by: number | null;
  created_at: string;
}

export type AccessLevel = 'none' | 'viewer' | 'member' | 'owner';

/** Access level ranking for comparisons. */
const RANK: Record<AccessLevel, number> = { none: 0, viewer: 1, member: 2, owner: 3 };

declare module 'fastify' {
  interface FastifyRequest {
    project?: ProjectRow;
    /** The requester's membership role on `project`, or null if not a member. */
    projectRole?: ProjectRole | null;
    /** The requester's effective access level on `project`. */
    projectAccess?: AccessLevel;
  }
}

/**
 * Compute the requester's effective access to a project.
 * - admins are implicit owners everywhere
 * - members get their stored role (owner/member)
 * - anyone (signed-in or anonymous) gets `viewer` on public projects
 * - private projects: members/admins only (`none` for everyone else)
 */
export function computeAccess(
  core: Db,
  project: ProjectRow,
  user: { id: number; role: 'admin' | 'user' } | null,
): { level: AccessLevel; role: ProjectRole | null } {
  if (!user) {
    if (!project.private) return { level: 'viewer', role: null };
    return { level: 'none', role: null };
  }
  if (user.role === 'admin') return { level: 'owner', role: null };

  const member = core
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(project.id, user.id) as { role: ProjectRole } | undefined;

  if (member) return { level: member.role, role: member.role };
  if (!project.private) return { level: 'viewer', role: null };
  return { level: 'none', role: null };
}

/**
 * preHandler factory: load `:id` project, compute access, and require at least
 * `min`. Anything below `viewer` yields **404** (existence is hidden from
 * non-viewers); a viewer attempting a member/owner action yields 404 too so a
 * private project's shape never leaks. Populates request.project/projectRole.
 */
export function requireProject(core: Db, min: AccessLevel) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const project = core.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined;
    if (!project) return sendError(reply, 404, 'NOT_FOUND', 'Project not found.');

    const { level, role } = computeAccess(core, project, req.user);
    if (RANK[level] < RANK[min]) {
      return sendError(reply, 404, 'NOT_FOUND', 'Project not found.');
    }
    req.project = project;
    req.projectRole = role;
    req.projectAccess = level;
  };
}
