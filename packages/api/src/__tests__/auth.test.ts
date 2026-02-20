import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildApp } from "../server.js";
import { createTestToken } from "../middleware/auth.js";
import type { FastifyInstance } from "fastify";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let app: FastifyInstance;

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

describe("Auth", () => {
  it("should return 401 for unauthenticated requests to protected routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/contracts",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("Unauthorized");
  });

  it("should allow each role to access permitted endpoints", async () => {
    for (const role of ["admin", "contracts_manager", "contracts_team", "viewer"] as const) {
      const token = createTestToken(app, { role });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/contracts",
        headers: { authorization: `Bearer ${token}` },
      });

      // All roles can read
      expect(response.statusCode).toBe(200);
    }
  });

  it("should prevent viewer from creating contracts (role escalation)", async () => {
    const token = createTestToken(app, { role: "viewer" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contractNumber: "AUTH-TEST-001",
        contractType: "FFP",
        awardingAgency: "DoD",
        contractingOfficerName: "Jane",
        contractingOfficerEmail: "jane@dod.mil",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
        ceilingValue: "1000000.00",
        fundedValue: "500000.00",
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
