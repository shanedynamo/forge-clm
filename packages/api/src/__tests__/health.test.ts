import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildApp } from "../server.js";
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

describe("Health endpoint", () => {
  it("GET /health returns 200 with status ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("forge-api");
    expect(body.timestamp).toBeDefined();
  });
});
