import type { FastifyInstance } from "fastify";
import { eq, desc, count } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mous, mouParties } from "../db/schema.js";
import { createMouSchema, updateMouSchema } from "../schemas/mou.schema.js";
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

export default async function mouRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db, fsmService } = opts;

  // ─── POST /mous ───────────────────────────────────────────────────

  app.post("/mous", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request, reply) => {
    const body = createMouSchema.parse(request.body);
    const { partyIds, ...mouData } = body;

    // Transaction: create MOU + junction rows
    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(mous).values(mouData).returning();
      const mouId = created!.id;

      if (partyIds.length > 0) {
        await tx.insert(mouParties).values(
          partyIds.map((p) => ({ mouId, partyId: p.partyId, role: p.role })),
        );
      }

      return created!;
    });

    return reply.status(201).send(result);
  });

  // ─── GET /mous ────────────────────────────────────────────────────

  app.get("/mous", async (request) => {
    const params = paginationSchema.parse(request.query);
    const offset = (params.page - 1) * params.limit;

    const [data, countResult] = await Promise.all([
      db.select().from(mous).orderBy(desc(mous.createdAt)).limit(params.limit).offset(offset),
      db.select({ total: count() }).from(mous),
    ]);

    return buildPaginatedResponse(data, countResult[0]!.total, params);
  });

  // ─── GET /mous/:id ────────────────────────────────────────────────

  app.get("/mous/:id", async (request) => {
    const { id } = uuidParam.parse(request.params);
    const [row] = await db.select().from(mous).where(eq(mous.id, id));
    if (!row) throw notFound("MOU", id);
    return row;
  });

  // ─── PATCH /mous/:id ──────────────────────────────────────────────

  app.patch("/mous/:id", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const body = updateMouSchema.parse(request.body);
    const { partyIds, ...mouData } = body;
    const [updated] = await db.update(mous).set({ ...mouData, updatedAt: new Date() }).where(eq(mous.id, id)).returning();
    if (!updated) throw notFound("MOU", id);
    return updated;
  });

  // ─── POST /mous/:id/transition ────────────────────────────────────

  app.post("/mous/:id/transition", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const { toState } = transitionBody.parse(request.body);
    const fsmRole = toFsmRole(request.user.role);
    const newState = await fsmService.transition("MOU", id, toState, request.user.userId, fsmRole);
    return { id, status: newState };
  });
}
