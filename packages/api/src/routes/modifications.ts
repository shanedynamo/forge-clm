import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { modifications } from "../db/schema.js";
import { createModificationSchema, updateModificationSchema } from "../schemas/modification.schema.js";
import { uuidParam, transitionBody } from "../schemas/common.schema.js";
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

export default async function modificationRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db, fsmService } = opts;

  // ─── POST /modifications ──────────────────────────────────────────

  app.post("/modifications", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request, reply) => {
    const body = createModificationSchema.parse(request.body);
    const [created] = await db.insert(modifications).values(body).returning();
    return reply.status(201).send(created);
  });

  // ─── GET /modifications/:id ───────────────────────────────────────

  app.get("/modifications/:id", async (request) => {
    const { id } = uuidParam.parse(request.params);
    const [row] = await db.select().from(modifications).where(eq(modifications.id, id));
    if (!row) throw notFound("Modification", id);
    return row;
  });

  // ─── PATCH /modifications/:id ─────────────────────────────────────

  app.patch("/modifications/:id", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const body = updateModificationSchema.parse(request.body);
    const [updated] = await db.update(modifications).set({ ...body, updatedAt: new Date() }).where(eq(modifications.id, id)).returning();
    if (!updated) throw notFound("Modification", id);
    return updated;
  });

  // ─── POST /modifications/:id/transition ───────────────────────────

  app.post("/modifications/:id/transition", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const { toState } = transitionBody.parse(request.body);
    const fsmRole = toFsmRole(request.user.role);
    const newState = await fsmService.transition("MODIFICATION", id, toState, request.user.userId, fsmRole);
    return { id, status: newState };
  });
}
