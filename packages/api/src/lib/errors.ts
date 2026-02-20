import type { FastifyInstance, FastifyError } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";
import { FsmError } from "@forge/shared";

// ─── Application error ──────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export function notFound(entity: string, id: string): AppError {
  return new AppError(`${entity} ${id} not found`, 404);
}

// ─── FSM error code → HTTP status ───────────────────────────────────

const FSM_STATUS_MAP: Record<string, number> = {
  INVALID_TRANSITION: 400,
  INVALID_STATE: 400,
  UNAUTHORIZED_ROLE: 403,
  HOOK_FAILED: 500,
};

// ─── Error handler plugin ───────────────────────────────────────────

async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    // Zod validation errors → 400
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "Validation Error",
        details: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }

    // FSM errors → mapped status
    if (error instanceof FsmError) {
      const status = FSM_STATUS_MAP[error.code] ?? 500;
      reply.status(status).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    // Application errors → statusCode
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }

    // Fastify validation errors (schema)
    if ("validation" in error && (error as FastifyError).validation) {
      reply.status(400).send({
        error: "Validation Error",
        details: (error as FastifyError).validation,
      });
      return;
    }

    // Unexpected errors
    const status = "statusCode" in error ? (error as FastifyError).statusCode ?? 500 : 500;
    reply.status(status).send({
      error: status >= 500 ? "Internal Server Error" : error.message,
    });
  });
}

export const errorHandlerPlugin = fp(errorHandler, {
  name: "error-handler",
});
