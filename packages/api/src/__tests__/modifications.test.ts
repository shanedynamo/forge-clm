import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildApp } from "../server.js";
import { createTestToken } from "../middleware/auth.js";
import { contracts, modifications, ndas, mous, parties } from "../db/schema.js";
import type { FastifyInstance } from "fastify";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let app: FastifyInstance;
let managerToken: string;
let teamToken: string;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL("../db/migrations", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });

  app = await buildApp(db);

  managerToken = createTestToken(app, { role: "contracts_manager" });
  teamToken = createTestToken(app, { role: "contracts_team" });
}, 60_000);

afterAll(async () => {
  await app.close();
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");
  await client.end();
});

beforeEach(async () => {
  await client.unsafe("SET session_replication_role = 'replica'");
  await db.delete(modifications);
  await db.delete(ndas);
  await db.delete(mous);
  await db.delete(parties);
  await db.delete(contracts);
  await client.unsafe("DELETE FROM audit.audit_log");
  await client.unsafe("SET session_replication_role = 'origin'");
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function seedContract() {
  const [c] = await db.insert(contracts).values({
    contractNumber: `MOD-C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    contractType: "FFP",
    awardingAgency: "DoD",
    contractingOfficerName: "Jane",
    contractingOfficerEmail: "jane@dod.mil",
    popStart: "2024-01-01",
    popEnd: "2025-12-31",
    ceilingValue: "1000000.00",
    fundedValue: "500000.00",
    status: "ACTIVE",
  }).returning();
  return c!;
}

describe("Modifications CRUD", () => {
  it("should create a modification linked to a contract", async () => {
    const contract = await seedContract();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/modifications",
      headers: authHeader(teamToken),
      payload: {
        contractId: contract.id,
        modNumber: "MOD-001",
        modType: "FUNDING",
        effectiveDate: "2024-06-01",
        description: "Funding increase",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.contractId).toBe(contract.id);
    expect(body.modNumber).toBe("MOD-001");
  });

  it("should transition a modification via FSM", async () => {
    const contract = await seedContract();

    const [mod] = await db.insert(modifications).values({
      contractId: contract.id,
      modNumber: `MOD-FSM-${Date.now()}`,
      modType: "SCOPE",
      effectiveDate: "2024-06-01",
      status: "MOD_DRAFTED",
    }).returning();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/modifications/${mod!.id}/transition`,
      headers: authHeader(teamToken),
      payload: { toState: "MOD_UNDER_REVIEW" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("MOD_UNDER_REVIEW");
  });

  it("should require auth on modification endpoints", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/modifications",
      payload: {
        contractId: "00000000-0000-0000-0000-000000000000",
        modNumber: "MOD-NOAUTH",
        modType: "ADMIN",
        effectiveDate: "2024-06-01",
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
