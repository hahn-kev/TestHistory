import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, sendError } from '../auth/guards.js';
import { requireProject, computeAccess, type ProjectRow } from '../auth/project-access.js';
import { newId, nowIso } from '../lib/ids.js';
import { pluginsDir } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, ProjectRole } from '@testhistory/shared';

const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  private: z.boolean().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  private: z.boolean().optional(),
});

function toProjectInfo(row: ProjectRow, myRole: ProjectRole | null): ProjectInfo {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    private: !!row.private,
    createdAt: row.created_at,
    myRole,
  };
}

export async function projectRoutes(app: FastifyInstance) {
  const core = app.core;

  // List visible projects: public + own memberships; admins see all.
  app.get('/api/projects', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    let rows: ProjectRow[];
    if (user.role === 'admin') {
      rows = core.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
    } else {
      rows = core
        .prepare(
          `SELECT p.* FROM projects p
             LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
            WHERE p.private = 0 OR m.user_id IS NOT NULL
            ORDER BY p.name`,
        )
        .all(user.id) as ProjectRow[];
    }
    const memberships = new Map(
      (core.prepare('SELECT project_id, role FROM project_members WHERE user_id = ?').all(user.id) as {
        project_id: string;
        role: ProjectRole;
      }[]).map((m) => [m.project_id, m.role]),
    );
    return {
      projects: rows.map((r) => toProjectInfo(r, memberships.get(r.id) ?? null)),
    };
  });

  // Create a project; creator becomes owner.
  app.post('/api/projects', { preHandler: requireUser }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { name, description, private: priv } = parsed.data;
    const existing = core.prepare('SELECT id FROM projects WHERE name = ?').get(name);
    if (existing) return sendError(reply, 409, 'NAME_TAKEN', 'A project with that name already exists.');

    const id = newId();
    const now = nowIso();
    const tx = core.transaction(() => {
      core
        .prepare(
          'INSERT INTO projects (id, name, description, private, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, name, description ?? null, priv ? 1 : 0, req.user!.id, now);
      core
        .prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
        .run(id, req.user!.id);
    });
    tx();
    // Materialize the per-project DB immediately so its schema exists.
    app.dbManager.get(id);
    const row = core.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
    return reply.code(201).send({ project: toProjectInfo(row, 'owner') });
  });

  app.get('/api/projects/:id', { preHandler: requireProject(core, 'viewer') }, async (req) => {
    return { project: toProjectInfo(req.project!, req.projectRole ?? null) };
  });

  app.patch('/api/projects/:id', { preHandler: requireProject(core, 'owner') }, async (req, reply) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const p = req.project!;
    const { name, description, private: priv } = parsed.data;
    if (name !== undefined && name !== p.name) {
      const clash = core.prepare('SELECT id FROM projects WHERE name = ? AND id != ?').get(name, p.id);
      if (clash) return sendError(reply, 409, 'NAME_TAKEN', 'A project with that name already exists.');
      core.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, p.id);
    }
    if (description !== undefined)
      core.prepare('UPDATE projects SET description = ? WHERE id = ?').run(description, p.id);
    if (priv !== undefined)
      core.prepare('UPDATE projects SET private = ? WHERE id = ?').run(priv ? 1 : 0, p.id);

    const row = core.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as ProjectRow;
    return { project: toProjectInfo(row, req.projectRole ?? null) };
  });

  app.delete('/api/projects/:id', { preHandler: requireProject(core, 'owner') }, async (req) => {
    const id = req.project!.id;
    // Remove plugin files, then the DB, then the core rows (cascade handles children).
    const plugins = core.prepare('SELECT id FROM plugins WHERE project_id = ?').all(id) as { id: string }[];
    for (const pl of plugins) {
      try {
        fs.rmSync(path.join(pluginsDir(app.config.dataDir), `${pl.id}.html`), { force: true });
      } catch {
        /* ignore */
      }
    }
    app.dbManager.deleteFiles(id);
    core.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { ok: true };
  });
}

export { computeAccess };
