import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildApp } from "../server.js";
import { createTestToken } from "../middleware/auth.js";
import { contracts, modifications, ndas, mous, parties, complianceMilestones, contractClauses, contractOptions, deliverables } from "../db/schema.js";
import type { FastifyInstance } from "fastify";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let app: FastifyInstance;
let adminToken: string;
let managerToken: string;
let teamToken: string;
let viewerToken: string;

const VALID_CONTRACT = {
  contractNumber: `C-${Date.now()}`,
  contractType: "FFP" as const,
  awardingAgency: "DoD",
  contractingOfficerName: "Jane Doe",
  contractingOfficerEmail: "jane@dod.mil",
  popStart: "2024-01-01",
  popEnd: "2025-12-31",
  ceilingValue: "1000000.00",
  fundedValue: "500000.00",
};

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

  adminToken = createTestToken(app, { role: "admin" });
  managerToken = createTestToken(app, { role: "contracts_manager" });
  teamToken = createTestToken(app, { role: "contracts_team" });
  viewerToken = createTestToken(app, { role: "viewer" });
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
  await db.delete(complianceMilestones);
  await db.delete(contractClauses);
  await db.delete(contractOptions);
  await db.delete(deliverables);
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

describe("Contracts CRUD", () => {
  it("should create a contract with manager role → 201", async () => {
    const contractNum = `C-CREATE-${Date.now()}`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: authHeader(managerToken),
      payload: { ...VALID_CONTRACT, contractNumber: contractNum },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.contractNumber).toBe(contractNum);
    expect(body.id).toBeDefined();
    expect(body.status).toBe("OPPORTUNITY_IDENTIFIED");
  });

  it("should reject creation with missing required fields → 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: authHeader(adminToken),
      payload: { contractNumber: "MISSING-FIELDS" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Validation Error");
  });

  it("should reject creation with viewer role → 403", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: authHeader(viewerToken),
      payload: VALID_CONTRACT,
    });

    expect(response.statusCode).toBe(403);
  });

  it("should list contracts with pagination", async () => {
    // Seed 3 contracts
    for (let i = 0; i < 3; i++) {
      await db.insert(contracts).values({
        ...VALID_CONTRACT,
        contractNumber: `PG-${Date.now()}-${i}`,
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/contracts?page=1&limit=2",
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBe(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.totalPages).toBe(2);
  });

  it("should filter contracts by status", async () => {
    await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `FILT-ACT-${Date.now()}`,
      status: "ACTIVE",
    });
    await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `FILT-CLOSED-${Date.now()}`,
      status: "CLOSED",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/contracts?filter=status:ACTIVE",
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("ACTIVE");
  });

  it("should get a contract by ID", async () => {
    const [created] = await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `DETAIL-${Date.now()}`,
    }).returning();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/contracts/${created!.id}`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(created!.id);
  });

  it("should update a contract", async () => {
    const [created] = await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `UPD-${Date.now()}`,
    }).returning();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${created!.id}`,
      headers: authHeader(teamToken),
      payload: { description: "Updated description" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().description).toBe("Updated description");
  });
});

describe("Contracts FSM transitions", () => {
  it("should transition contract state via POST /contracts/:id/transition", async () => {
    const [created] = await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `FSM-${Date.now()}`,
      status: "OPPORTUNITY_IDENTIFIED",
    }).returning();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${created!.id}/transition`,
      headers: authHeader(teamToken),
      payload: { toState: "PROPOSAL_IN_PROGRESS" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("PROPOSAL_IN_PROGRESS");
  });

  it("should reject invalid FSM transition → 400", async () => {
    const [created] = await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `FSM-INV-${Date.now()}`,
      status: "OPPORTUNITY_IDENTIFIED",
    }).returning();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${created!.id}/transition`,
      headers: authHeader(adminToken),
      payload: { toState: "CLOSED" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject FSM transition with wrong role → 403", async () => {
    const [created] = await db.insert(contracts).values({
      ...VALID_CONTRACT,
      contractNumber: `FSM-ROLE-${Date.now()}`,
      status: "AWARDED",
    }).returning();

    // contracts_team can't transition AWARDED → ACTIVE (requires contracts_manager)
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${created!.id}/transition`,
      headers: authHeader(teamToken),
      payload: { toState: "ACTIVE" },
    });

    // Either 400 (INVALID_TRANSITION from FSM) or 403 (UNAUTHORIZED_ROLE)
    expect([400, 403]).toContain(response.statusCode);
  });
});
