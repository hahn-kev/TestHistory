import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionUser } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated session user, populated by the session onRequest hook. */
    user: SessionUser | null;
  }
}

/** Standard error envelope: `{ error: { code, message } }`. */
export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/** preHandler: require an authenticated session user (401 otherwise). */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) {
    return sendError(reply, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }
}

/** preHandler: require an authenticated admin (401 if anon, 403 if non-admin). */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) {
    return sendError(reply, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  if (req.user.role !== 'admin') {
    return sendError(reply, 403, 'FORBIDDEN', 'Admin privileges required.');
  }
}
