import type { FastifyInstance } from "fastify";
import { eq, desc, count } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { ndas } from "../db/schema.js";
import { createNdaSchema, updateNdaSchema } from "../schemas/nda.schema.js";
import { uuidParam, transitionBody } from "../schemas/common.schema.js";
import { paginationSchema, buildPaginatedResponse } from "../lib/pagination.js";
import { requireRole } from "../middleware/auth.js";
import { notFound } from "../lib/errors.js";
import { toFsmRole } from "../lib/role-map.js";
import type { FsmService } from "../services/fsm-service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

interface RouteOptions {
  db: AnyDb;
  fsmService: FsmService;
}

export default async function ndaRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db, fsmService } = opts;

  // ─── POST /ndas ───────────────────────────────────────────────────

  app.post("/ndas", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request, reply) => {
    const body = createNdaSchema.parse(request.body);
    const [created] = await db.insert(ndas).values(body).returning();
    return reply.status(201).send(created);
  });

  // ─── GET /ndas ────────────────────────────────────────────────────

  app.get("/ndas", async (request) => {
    const params = paginationSchema.parse(request.query);
    const offset = (params.page - 1) * params.limit;

    const [data, countResult] = await Promise.all([
      db.select().from(ndas).orderBy(desc(ndas.createdAt)).limit(params.limit).offset(offset),
      db.select({ total: count() }).from(ndas),
    ]);

    return buildPaginatedResponse(data, countResult[0]!.total, params);
  });

  // ─── GET /ndas/:id ────────────────────────────────────────────────

  app.get("/ndas/:id", async (request) => {
    const { id } = uuidParam.parse(request.params);
    const [row] = await db.select().from(ndas).where(eq(ndas.id, id));
    if (!row) throw notFound("NDA", id);
    return row;
  });

  // ─── PATCH /ndas/:id ──────────────────────────────────────────────

  app.patch("/ndas/:id", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const body = updateNdaSchema.parse(request.body);
    const [updated] = await db.update(ndas).set({ ...body, updatedAt: new Date() }).where(eq(ndas.id, id)).returning();
    if (!updated) throw notFound("NDA", id);
    return updated;
  });

  // ─── POST /ndas/:id/transition ────────────────────────────────────

  app.post("/ndas/:id/transition", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const { toState } = transitionBody.parse(request.body);
    const fsmRole = toFsmRole(request.user.role);
    const newState = await fsmService.transition("NDA", id, toState, request.user.userId, fsmRole);
    return { id, status: newState };
  });
}
