import type { FastifyInstance } from "fastify";
import { eq, desc, count, and, type Column } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  contracts,
  contractClauses,
  modifications as modsTable,
  contractOptions,
  deliverables,
  complianceMilestones,
} from "../db/schema.js";
import { createContractSchema, updateContractSchema } from "../schemas/contract.schema.js";
import { uuidParam, transitionBody } from "../schemas/common.schema.js";
import { paginationSchema, buildPaginatedResponse, parseSortParam, parseFilterParam } from "../lib/pagination.js";
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

export default async function contractRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db, fsmService } = opts;

  const COLUMN_MAP: Record<string, Column> = {
    contractNumber: contracts.contractNumber,
    ceilingValue: contracts.ceilingValue,
    status: contracts.status,
    awardingAgency: contracts.awardingAgency,
    createdAt: contracts.createdAt,
    contractType: contracts.contractType,
  };

  // ─── POST /contracts ────────────────────────────────────────────────

  app.post("/contracts", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request, reply) => {
    const body = createContractSchema.parse(request.body);
    const [created] = await db.insert(contracts).values(body).returning();
    return reply.status(201).send(created);
  });

  // ─── GET /contracts ─────────────────────────────────────────────────

  app.get("/contracts", async (request) => {
    const params = paginationSchema.parse(request.query);
    const offset = (params.page - 1) * params.limit;

    const sortOrder = parseSortParam(params.sort, COLUMN_MAP, desc(contracts.createdAt));
    const filters = parseFilterParam(params.filter, COLUMN_MAP);

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [data, countResult] = await Promise.all([
      db.select().from(contracts).where(where).orderBy(sortOrder).limit(params.limit).offset(offset),
      db.select({ total: count() }).from(contracts).where(where),
    ]);

    return buildPaginatedResponse(data, countResult[0]!.total, params);
  });

  // ─── GET /contracts/:id ─────────────────────────────────────────────

  app.get("/contracts/:id", async (request) => {
    const { id } = uuidParam.parse(request.params);
    const [row] = await db.select().from(contracts).where(eq(contracts.id, id));
    if (!row) throw notFound("Contract", id);
    return row;
  });

  // ─── PATCH /contracts/:id ───────────────────────────────────────────

  app.patch("/contracts/:id", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const body = updateContractSchema.parse(request.body);
    const [updated] = await db.update(contracts).set({ ...body, updatedAt: new Date() }).where(eq(contracts.id, id)).returning();
    if (!updated) throw notFound("Contract", id);
    return updated;
  });

  // ─── POST /contracts/:id/transition ─────────────────────────────────

  app.post("/contracts/:id/transition", { preHandler: requireRole("admin", "contracts_manager", "contracts_team") }, async (request) => {
    const { id } = uuidParam.parse(request.params);
    const { toState } = transitionBody.parse(request.body);
    const fsmRole = toFsmRole(request.user.role);
    const newState = await fsmService.transition("PRIME_CONTRACT", id, toState, request.user.userId, fsmRole);
    return { id, status: newState };
  });

  // ─── GET /contracts/:id/history ─────────────────────────────────────

  app.get("/contracts/:id/history", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return fsmService.getHistory("PRIME_CONTRACT", id);
  });

  // ─── Sub-resource routes ────────────────────────────────────────────

  app.get("/contracts/:id/clauses", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return db.select().from(contractClauses).where(eq(contractClauses.contractId, id));
  });

  app.get("/contracts/:id/mods", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return db.select().from(modsTable).where(eq(modsTable.contractId, id));
  });

  app.get("/contracts/:id/options", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return db.select().from(contractOptions).where(eq(contractOptions.contractId, id));
  });

  app.get("/contracts/:id/deliverables", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return db.select().from(deliverables).where(eq(deliverables.contractId, id));
  });

  app.get("/contracts/:id/compliance", async (request) => {
    const { id } = uuidParam.parse(request.params);
    return db.select().from(complianceMilestones).where(eq(complianceMilestones.contractId, id));
  });
}
