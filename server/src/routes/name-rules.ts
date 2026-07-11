import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../auth/guards.js';
import { requireProject } from '../auth/project-access.js';
import { compileRules, applyRules } from '../ingest/names.js';
import { nowIso } from '../lib/ids.js';
import type { NameRule, NameRulePreviewSample } from '@testhistory/shared';

const rulesBody = z.object({
  rules: z
    .array(z.object({ match: z.string().min(1), rewrite: z.string() }))
    .max(100),
});

/** Compile rules, returning a bad-regex message if any is invalid. */
function validate(rules: NameRule[]): string | null {
  try {
    compileRules(rules);
    return null;
  } catch (e) {
    return `Invalid regular expression: ${(e as Error).message}`;
  }
}

export async function nameRuleRoutes(app: FastifyInstance) {
  const core = app.core;
  const member = requireProject(core, 'member');

  app.get('/api/projects/:id/name-rules', { preHandler: member }, async (req) => {
    const rules = app.dbManager
      .get(req.project!.id)
      .prepare('SELECT match, rewrite FROM name_rules ORDER BY position')
      .all() as NameRule[];
    return { rules };
  });

  app.put('/api/projects/:id/name-rules', { preHandler: member }, async (req, reply) => {
    const parsed = rulesBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const badRegex = validate(parsed.data.rules);
    if (badRegex) return sendError(reply, 400, 'BAD_REGEX', badRegex);

    const d = app.dbManager.get(req.project!.id);
    const now = nowIso();
    const replace = d.transaction((rules: NameRule[]) => {
      d.prepare('DELETE FROM name_rules').run();
      const ins = d.prepare('INSERT INTO name_rules (position, match, rewrite, created_at) VALUES (?, ?, ?, ?)');
      rules.forEach((r, i) => ins.run(i, r.match, r.rewrite, now));
    });
    replace(parsed.data.rules);
    return { rules: parsed.data.rules };
  });

  app.post('/api/projects/:id/name-rules/preview', { preHandler: member }, async (req, reply) => {
    const parsed = rulesBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const badRegex = validate(parsed.data.rules);
    if (badRegex) return sendError(reply, 400, 'BAD_REGEX', badRegex);

    const compiled = compileRules(parsed.data.rules);
    const recent = app.dbManager
      .get(req.project!.id)
      .prepare('SELECT suite, name FROM tests ORDER BY last_seen_run_id DESC, id DESC LIMIT 50')
      .all() as { suite: string; name: string }[];

    const samples: NameRulePreviewSample[] = recent.map((r) => ({
      before: { suite: r.suite, name: r.name },
      after: applyRules(compiled, r.suite, r.name),
    }));
    return { samples };
  });
}
