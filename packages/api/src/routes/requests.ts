import type { FastifyInstance } from "fastify";
import { eq, desc, count, and, type Column } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { contractRequests } from "../db/schema.js";
import { createRequestSchema, updateRequestSchema } from "../schemas/request.schema.js";
import { uuidParam } from "../schemas/common.schema.js";
import { paginationSchema, buildPaginatedResponse, parseSortParam, parseFilterParam } from "../lib/pagination.js";
import { requireRole } from "../middleware/auth.js";
import { notFound } from "../lib/errors.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

interface RouteOptions {
  db: AnyDb;
  fsmService: unknown;
}

export default async function requestRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db } = opts;

  const COLUMN_MAP: Record<string, Column> = {
    requestType: contractRequests.requestType,
    priority: contractRequests.priority,
    status: contractRequests.status,
    createdAt: contractRequests.createdAt,
  };

  // ─── POST /requests ───────────────────────────────────────────────

  app.post("/requests", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request, reply) => {
    const body = createRequestSchema.parse(request.body);
    const [created] = await db.insert(contractRequests).values(body).returning();
    return reply.status(201).send(created);
  });

  // ─── GET /requests ────────────────────────────────────────────────

  app.get("/requests", async (request) => {
    const params = paginationSchema.parse(request.query);
    const offset = (params.page - 1) * params.limit;

    const sortOrder = parseSortParam(params.sort, COLUMN_MAP, desc(contractRequests.createdAt));
    const filters = parseFilterParam(params.filter, COLUMN_MAP);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [data, countResult] = await Promise.all([
      db.select().from(contractRequests).where(where).orderBy(sortOrder).limit(params.limit).offset(offset),
      db.select({ total: count() }).from(contractRequests).where(where),
    ]);

    return buildPaginatedResponse(data, countResult[0]!.total, params);
  });

  // ─── GET /requests/:id ────────────────────────────────────────────

  app.get("/requests/:id", async (request) => {
    const { id } = uuidParam.parse(request.params);
    const [row] = await db.select().from(contractRequests).where(eq(contractRequests.id, id));
    if (!row) throw notFound("Request", id);
    return row;
  });

  // ─── PATCH /requests/:id ──────────────────────────────────────────

  app.patch("/requests/:id", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const body = updateRequestSchema.parse(request.body);
    const [updated] = await db.update(contractRequests).set({ ...body, updatedAt: new Date() }).where(eq(contractRequests.id, id)).returning();
    if (!updated) throw notFound("Request", id);
    return updated;
  });
}
