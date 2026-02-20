import type { FastifyInstance } from "fastify";
import { sql, and, lte, gt, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { complianceMilestones } from "../db/schema.js";
import { upcomingQuerySchema } from "../schemas/compliance.schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

interface RouteOptions {
  db: AnyDb;
  fsmService: unknown;
}

export default async function complianceRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db } = opts;

  // ─── GET /compliance/upcoming ─────────────────────────────────────

  app.get("/compliance/upcoming", async (request) => {
    const { days } = upcomingQuerySchema.parse(request.query);

    const rows = await db
      .select()
      .from(complianceMilestones)
      .where(
        and(
          sql`${complianceMilestones.status} = 'PENDING'`,
          lte(complianceMilestones.dueDate, sql`CURRENT_DATE + ${days}::integer`),
          gt(complianceMilestones.dueDate, sql`CURRENT_DATE`),
        ),
      );

    return { data: rows };
  });

  // ─── GET /compliance/overdue ──────────────────────────────────────

  app.get("/compliance/overdue", async () => {
    const rows = await db
      .select()
      .from(complianceMilestones)
      .where(
        and(
          notInArray(complianceMilestones.status, ["COMPLETED", "WAIVED"]),
          lte(complianceMilestones.dueDate, sql`CURRENT_DATE`),
        ),
      );

    return { data: rows };
  });
}
