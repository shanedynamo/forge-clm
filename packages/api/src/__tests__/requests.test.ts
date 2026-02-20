import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildApp } from "../server.js";
import { createTestToken } from "../middleware/auth.js";
import { contractRequests } from "../db/schema.js";
import type { FastifyInstance } from "fastify";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let app: FastifyInstance;
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
  await db.delete(contractRequests);
  await client.unsafe("SET session_replication_role = 'origin'");
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("Requests", () => {
  it("should create different request types", async () => {
    for (const requestType of ["NDA", "MOU", "NEW_CONTRACT"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/requests",
        headers: authHeader(teamToken),
        payload: {
          requestType,
          requesterName: "John Doe",
          requesterEmail: "john@example.com",
          priority: "HIGH",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().requestType).toBe(requestType);
    }
  });

  it("should list requests with filters", async () => {
    // Seed some requests
    await db.insert(contractRequests).values([
      { requestType: "NDA", requesterName: "A", requesterEmail: "a@x.com", priority: "HIGH", status: "OPEN" },
      { requestType: "MOU", requesterName: "B", requesterEmail: "b@x.com", priority: "LOW", status: "OPEN" },
      { requestType: "NDA", requesterName: "C", requesterEmail: "c@x.com", priority: "MEDIUM", status: "CLOSED" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/requests?filter=requestType:NDA",
      headers: authHeader(teamToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBe(2);
    body.data.forEach((r: { requestType: string }) => {
      expect(r.requestType).toBe("NDA");
    });
  });
});
