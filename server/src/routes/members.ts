import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../auth/guards.js';
import { requireProject } from '../auth/project-access.js';
import type { ProjectMemberInfo, ProjectRole } from '@testhistory/shared';

const addBody = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['owner', 'member']).default('member'),
});

export async function memberRoutes(app: FastifyInstance) {
  const core = app.core;

  app.get('/api/projects/:id/members', { preHandler: requireProject(core, 'owner') }, async (req) => {
    const rows = core
      .prepare(
        `SELECT m.user_id AS userId, u.email AS email, u.display_name AS displayName, m.role AS role
           FROM project_members m JOIN users u ON u.id = m.user_id
          WHERE m.project_id = ? ORDER BY m.role, u.email`,
      )
      .all(req.project!.id) as ProjectMemberInfo[];
    return { members: rows };
  });

  app.post('/api/projects/:id/members', { preHandler: requireProject(core, 'owner') }, async (req, reply) => {
    const parsed = addBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { userId, role } = parsed.data;
    const user = core.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found.');
    core
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(req.project!.id, userId, role);
    return reply.code(201).send({ ok: true });
  });

  app.delete(
    '/api/projects/:id/members/:userId',
    { preHandler: requireProject(core, 'owner') },
    async (req, reply) => {
      const userId = Number((req.params as { userId: string }).userId);
      const projectId = req.project!.id;
      // Refuse to remove the last owner.
      const target = core
        .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(projectId, userId) as { role: ProjectRole } | undefined;
      if (target?.role === 'owner') {
        const owners = core
          .prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'")
          .get(projectId) as { n: number };
        if (owners.n <= 1) {
          return sendError(reply, 409, 'LAST_OWNER', 'Cannot remove the last owner.');
        }
      }
      core.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
      return { ok: true };
    },
  );
}
