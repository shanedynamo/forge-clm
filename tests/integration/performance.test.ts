/**
 * Performance benchmarks — API response times, DB throughput, vector search latency.
 *
 * Runs against the Docker Compose test stack (postgres-test:5433).
 * Thresholds are conservative CI-friendly values; tighten for production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { buildApp } from "../../packages/api/src/server.js";
import { createTestToken } from "../../packages/api/src/middleware/auth.js";
import { MockLLMProvider } from "../../packages/api/src/services/llm-provider.js";
import type { EmbeddingClient } from "../../packages/api/src/services/vector-search-service.js";
import type { FastifyInstance } from "fastify";

// ─── Helpers ────────────────────────────────────────────────────────

const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

function fakeEmbedding(): number[] {
  return Array.from({ length: 768 }, () => Math.random() * 2 - 1);
}

/** Immediate-return embedding client for benchmarking without NLP overhead. */
class InMemoryEmbeddingClient implements EmbeddingClient {
  async embed(_text: string): Promise<number[]> {
    return fakeEmbedding();
  }
}

// ─── Setup / Teardown ───────────────────────────────────────────────

let client: ReturnType<typeof postgres>;
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 10 });
  const db = drizzle(client);

  // Fresh schema
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL(
    "../../packages/api/src/db/migrations",
    import.meta.url,
  ).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });

  // Build app with DI: in-memory embedding + mock LLM
  app = await buildApp(db, {
    embeddingClient: new InMemoryEmbeddingClient(),
    llmProvider: new MockLLMProvider(),
  });

  token = createTestToken(app, { role: "admin" });
}, 120_000);

afterAll(async () => {
  await app.close();
  await client.end();
});

beforeEach(async () => {
  // Clean data between benchmarks
  await client.unsafe("SET session_replication_role = 'replica'");
  await client.unsafe("DELETE FROM vectors.document_chunks");
  await client.unsafe("DELETE FROM contracts.compliance_milestones");
  await client.unsafe("DELETE FROM contracts.contract_clauses");
  await client.unsafe("DELETE FROM contracts.modifications");
  await client.unsafe("DELETE FROM contracts.contracts");
  await client.unsafe("SET session_replication_role = 'origin'");
});

// ─── Seed helpers ───────────────────────────────────────────────────

async function seedContracts(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const num = `PERF-${Date.now()}-${i.toString().padStart(4, "0")}`;
    const rows = await client.unsafe(
      `INSERT INTO contracts.contracts
       (contract_number, contract_type, awarding_agency,
        contracting_officer_name, contracting_officer_email,
        pop_start, pop_end, ceiling_value, funded_value, status)
       VALUES ($1, 'FFP', 'USAF', 'CO', 'co@test.gov',
               '2025-01-01', '2026-12-31', '5000000.00', '3000000.00', 'ACTIVE')
       RETURNING id`,
      [num],
    );
    ids.push((rows[0] as any).id);
  }
  return ids;
}

async function seedChunks(contractId: string, count: number): Promise<void> {
  const sectionTypes = [
    "SECTION_A", "SECTION_B", "SECTION_C", "SECTION_I", "OTHER",
  ];
  const batch = 100; // Insert in batches to avoid query-too-large
  for (let start = 0; start < count; start += batch) {
    const end = Math.min(start + batch, count);
    const values: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    for (let i = start; i < end; i++) {
      const section = sectionTypes[i % sectionTypes.length]!;
      const vec = fakeEmbedding();
      const vecStr = `[${vec.join(",")}]`;
      values.push(
        `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}::vector)`,
      );
      params.push(
        contractId,
        `s3://bucket/doc-${i}.pdf`,
        i,
        section,
        `Performance test chunk ${i} containing sample contract text about intellectual property rights and DFARS 252.227-7013 compliance requirements for Section ${section}.`,
        vecStr,
      );
    }

    await client.unsafe(
      `INSERT INTO vectors.document_chunks
       (contract_id, document_s3_key, chunk_index, section_type, chunk_text, embedding)
       VALUES ${values.join(", ")}`,
      params,
    );
  }
}

// ─── 1. API Response Time Benchmarks ────────────────────────────────

describe("API Response Time Benchmarks", () => {
  it("GET /health responds in < 50ms", async () => {
    // Warm up
    await app.inject({ method: "GET", url: "/health" });

    const start = performance.now();
    const res = await app.inject({ method: "GET", url: "/health" });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });

  it("GET /contracts with 50 seeded contracts responds in < 200ms", async () => {
    await seedContracts(50);

    // Warm up
    await app.inject({
      method: "GET",
      url: "/api/v1/contracts",
      headers: { authorization: `Bearer ${token}` },
    });

    const start = performance.now();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/contracts",
      headers: { authorization: `Bearer ${token}` },
    });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(20); // Default page size
    expect(elapsed).toBeLessThan(200);
  });

  it("GET /contracts/:id with relations responds in < 300ms", async () => {
    const [contractId] = await seedContracts(1);

    // Add clauses and modifications
    await client.unsafe(
      `INSERT INTO contracts.contract_clauses
       (contract_id, clause_number, clause_title, clause_type, is_deviation)
       VALUES ($1, '52.204-21', 'CUI', 'FAR', false),
              ($1, '252.227-7013', 'Rights', 'DFARS', false)`,
      [contractId],
    );
    await client.unsafe(
      `INSERT INTO contracts.modifications
       (contract_id, mod_number, mod_type, description, effective_date)
       VALUES ($1, 'P00001', 'FUNDING', 'Incremental funding', '2025-06-01')`,
      [contractId],
    );

    // Warm up
    await app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contractId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const start = performance.now();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contractId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(300);
  });

  it("POST /search with 1000 chunks responds in < 500ms", async () => {
    const [contractId] = await seedContracts(1);
    await seedChunks(contractId!, 1000);

    // Warm up
    await app.inject({
      method: "POST",
      url: "/api/v1/search",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "intellectual property rights" }),
    });

    const start = performance.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/search",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "intellectual property rights" }),
    });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("POST /ask (RAG with mock LLM) responds in < 1000ms", async () => {
    const [contractId] = await seedContracts(1);
    await seedChunks(contractId!, 200);

    const start = performance.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ask",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        question: "What are the IP rights on this contract?",
        contract_id: contractId,
      }),
    });
    const elapsed = performance.now() - start;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.answer).toBeTruthy();
    expect(body.citations).toBeDefined();
    expect(elapsed).toBeLessThan(1000);
  });
});

// ─── 2. Database Performance Benchmarks ─────────────────────────────

describe("Database Performance Benchmarks", () => {
  it("inserts 100 contracts in a single transaction in < 2s", async () => {
    const start = performance.now();

    await client.begin(async (sql) => {
      for (let i = 0; i < 100; i++) {
        const num = `BULK-${Date.now()}-${i.toString().padStart(4, "0")}`;
        await sql.unsafe(
          `INSERT INTO contracts.contracts
           (contract_number, contract_type, awarding_agency,
            contracting_officer_name, contracting_officer_email,
            pop_start, pop_end, ceiling_value, funded_value, status)
           VALUES ($1, 'FFP', 'USAF', 'CO', 'co@test.gov',
                   '2025-01-01', '2026-12-31', '5000000.00', '3000000.00', 'ACTIVE')`,
          [num],
        );
      }
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);

    // Verify all inserted
    const rows = await client.unsafe("SELECT count(*) AS c FROM contracts.contracts");
    expect(Number((rows[0] as any).c)).toBe(100);
  });

  it("vector similarity search over 10K chunks in < 200ms", async () => {
    const [contractId] = await seedContracts(1);
    await seedChunks(contractId!, 10_000);

    // Verify chunk count
    const countRows = await client.unsafe("SELECT count(*) AS c FROM vectors.document_chunks");
    expect(Number((countRows[0] as any).c)).toBe(10_000);

    const queryVec = fakeEmbedding();
    const vecStr = `[${queryVec.join(",")}]`;

    // Warm up
    await client.unsafe(
      `SELECT id, 1 - (embedding <=> '${vecStr}'::vector) AS similarity
       FROM vectors.document_chunks
       ORDER BY embedding <=> '${vecStr}'::vector ASC
       LIMIT 10`,
    );

    const start = performance.now();
    const results = await client.unsafe(
      `SELECT id, 1 - (embedding <=> '${vecStr}'::vector) AS similarity
       FROM vectors.document_chunks
       ORDER BY embedding <=> '${vecStr}'::vector ASC
       LIMIT 10`,
    );
    const elapsed = performance.now() - start;

    expect(results.length).toBe(10);
    expect(elapsed).toBeLessThan(200);
  });

  it("complex join query (contracts + clauses + mods + compliance) in < 100ms", async () => {
    // Seed 10 contracts with clauses, mods, and compliance milestones
    const contractIds = await seedContracts(10);
    for (const cid of contractIds) {
      await client.unsafe(
        `INSERT INTO contracts.contract_clauses
         (contract_id, clause_number, clause_title, clause_type, is_deviation)
         VALUES ($1, '52.204-21', 'CUI', 'FAR', false),
                ($1, '252.227-7013', 'Rights', 'DFARS', false)`,
        [cid],
      );
      await client.unsafe(
        `INSERT INTO contracts.modifications
         (contract_id, mod_number, mod_type, description, effective_date)
         VALUES ($1, 'P00001', 'FUNDING', 'Funding increase', '2025-06-01')`,
        [cid],
      );
      await client.unsafe(
        `INSERT INTO contracts.compliance_milestones
         (contract_id, milestone_type, due_date, recurrence, responsible_party, status, description)
         VALUES ($1, 'CDRL Delivery', '2025-09-01', 'MONTHLY', 'Contractor', 'PENDING', 'Monthly CDRL submission')`,
        [cid],
      );
    }

    // Warm up
    await client.unsafe(`
      SELECT c.id, c.contract_number, c.ceiling_value,
             count(DISTINCT cl.id) AS clause_count,
             count(DISTINCT m.id) AS mod_count,
             count(DISTINCT cm.id) AS milestone_count
      FROM contracts.contracts c
      LEFT JOIN contracts.contract_clauses cl ON cl.contract_id = c.id
      LEFT JOIN contracts.modifications m ON m.contract_id = c.id
      LEFT JOIN contracts.compliance_milestones cm ON cm.contract_id = c.id
      GROUP BY c.id
      ORDER BY c.ceiling_value DESC
    `);

    const start = performance.now();
    const rows = await client.unsafe(`
      SELECT c.id, c.contract_number, c.ceiling_value,
             count(DISTINCT cl.id) AS clause_count,
             count(DISTINCT m.id) AS mod_count,
             count(DISTINCT cm.id) AS milestone_count
      FROM contracts.contracts c
      LEFT JOIN contracts.contract_clauses cl ON cl.contract_id = c.id
      LEFT JOIN contracts.modifications m ON m.contract_id = c.id
      LEFT JOIN contracts.compliance_milestones cm ON cm.contract_id = c.id
      GROUP BY c.id
      ORDER BY c.ceiling_value DESC
    `);
    const elapsed = performance.now() - start;

    expect(rows.length).toBe(10);
    expect(Number((rows[0] as any).clause_count)).toBe(2);
    expect(Number((rows[0] as any).mod_count)).toBe(1);
    expect(Number((rows[0] as any).milestone_count)).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });
});
