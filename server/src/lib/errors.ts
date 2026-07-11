import type { FastifyInstance } from 'fastify';

/** An error carrying an HTTP status + machine code, rendered as our error envelope. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Register the error handler that renders `{ error: { code, message } }`. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    // Fastify's own errors (validation, rate-limit, payload) carry statusCode.
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const code = (err as { code?: string }).code ?? (status === 500 ? 'INTERNAL' : 'ERROR');
    const message = status === 500 ? 'Internal server error.' : (err as Error).message;
    if (status === 500) app.log.error(err as Error);
    return reply.code(status).send({ error: { code, message } });
  });
}
