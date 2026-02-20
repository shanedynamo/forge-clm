import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { contracts } from "../../db/schema.js";
import { documentChunks, entityAnnotations } from "../../db/schema-vectors.js";
import {
  VectorSearchService,
  type EmbeddingClient,
} from "../vector-search-service.js";
import { RAGService } from "../rag-service.js";
import { MockLLMProvider } from "../llm-provider.js";
import { buildApp } from "../../server.js";
import { createTestToken } from "../../middleware/auth.js";
import type { FastifyInstance } from "fastify";

// ─── Test config ─────────────────────────────────────────────────────

const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let vectorSearch: VectorSearchService;
let ragService: RAGService;
let mockLLM: MockLLMProvider;
let app: FastifyInstance;
let adminToken: string;
let contractIds: string[] = [];

// ─── Topic-based embeddings (same as vector-search test) ─────────────

const TOPICS = {
  ip: 0,
  deliverable: 1,
  far_clause: 2,
  pricing: 3,
  scope: 4,
  security: 5,
} as const;

function topicEmbedding(topicIndex: number, dims = 768): number[] {
  const vec = new Array(dims).fill(0.01);
  vec[topicIndex] = 1.0;
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}

class TestEmbeddingClient implements EmbeddingClient {
  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();
    if (lower.includes("intellectual property") || lower.includes("data rights"))
      return topicEmbedding(TOPICS.ip);
    if (lower.includes("deliverable") || lower.includes("schedule") || lower.includes("reporting"))
      return topicEmbedding(TOPICS.deliverable);
    if (lower.includes("far clause") || lower.includes("52.212"))
      return topicEmbedding(TOPICS.far_clause);
    if (lower.includes("pricing") || lower.includes("ceiling") || lower.includes("cost"))
      return topicEmbedding(TOPICS.pricing);
    if (lower.includes("scope") || lower.includes("obligation") || lower.includes("terms"))
      return topicEmbedding(TOPICS.scope);
    if (lower.includes("security") || lower.includes("cybersecurity"))
      return topicEmbedding(TOPICS.security);
    // Default
    return topicEmbedding(TOPICS.scope);
  }
}

// ─── Seed data ───────────────────────────────────────────────────────

const CHUNK_DEFS = [
  { idx: 0, section: "SECTION_H", clause: "52.227-14", text: "Intellectual property and data rights. The Government shall have unlimited rights in technical data.", topic: "ip" as const },
  { idx: 1, section: "SECTION_F", clause: null, text: "Deliverable schedule. Monthly status reports due by the 15th. Final report within 30 days of completion.", topic: "deliverable" as const },
  { idx: 2, section: "SECTION_I", clause: "52.212-4", text: "FAR clause 52.212-4 standard commercial terms. Inspection, acceptance, payment, and disputes provisions.", topic: "far_clause" as const },
  { idx: 3, section: "SECTION_B", clause: null, text: "Pricing. Total ceiling value $12,500,000. Currently funded at $5,000,000. Incrementally funded contract.", topic: "pricing" as const },
  { idx: 4, section: "SECTION_C", clause: null, text: "Scope of work. Systems engineering support for radar development. The contractor shall provide technical analysis.", topic: "scope" as const },
  { idx: 5, section: "SECTION_H", clause: null, text: "Security requirements. SECRET clearance required. Comply with NIST SP 800-171 for CUI handling.", topic: "security" as const },
  // Clause for deviation analysis
  { idx: 6, section: "SECTION_I", clause: "52.249-1", text: "Termination clause with non-standard liability limitation. Contractor liability capped at contract value. Government waives consequential damages.", topic: "far_clause" as const },
];

// ─── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL("../../db/migrations", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });

  const embeddingClient = new TestEmbeddingClient();
  mockLLM = new MockLLMProvider();
  vectorSearch = new VectorSearchService(db, embeddingClient);
  ragService = new RAGService(vectorSearch, mockLLM);

  // Build Fastify app with test dependencies
  app = await buildApp(db, { embeddingClient, llmProvider: mockLLM });
  adminToken = createTestToken(app, { role: "admin" });

  // Seed data
  await seedData();
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

async function seedData() {
  await client.unsafe("SET session_replication_role = 'replica'");

  // Insert 2 contracts
  contractIds = [];
  for (const c of [
    { number: "RAG-FA8726-24-C-0042", type: "FFP" as const, agency: "US Air Force" },
    { number: "RAG-N00024-23-C-5500", type: "CPFF" as const, agency: "US Navy" },
  ]) {
    const [row] = await db
      .insert(contracts)
      .values({
        contractNumber: c.number,
        contractType: c.type,
        awardingAgency: c.agency,
        contractingOfficerName: "Test Officer",
        contractingOfficerEmail: "test@gov.mil",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
        ceilingValue: "12500000.00",
        fundedValue: "5000000.00",
        status: "ACTIVE",
      })
      .returning();
    contractIds.push(row!.id);
  }

  // Insert chunks for contract 0
  for (const chunk of CHUNK_DEFS) {
    const embedding = topicEmbedding(TOPICS[chunk.topic]);

    const [inserted] = await db
      .insert(documentChunks)
      .values({
        contractId: contractIds[0]!,
        documentS3Key: "contracts/RAG-FA8726-24-C-0042.docx",
        chunkIndex: chunk.idx,
        sectionType: chunk.section as any,
        clauseNumber: chunk.clause,
        chunkText: chunk.text,
        embedding,
      })
      .returning();

    if (chunk.clause) {
      await db.insert(entityAnnotations).values({
        chunkId: inserted!.id,
        entityType: "FAR_CLAUSE",
        entityValue: chunk.clause,
        startChar: 0,
        endChar: chunk.clause.length,
        confidence: "0.95",
        modelVersion: "test-v0.1",
      });
    }
  }

  // Insert a few chunks for contract 1
  for (const chunk of CHUNK_DEFS.slice(0, 3)) {
    const embedding = topicEmbedding(TOPICS[chunk.topic]);
    await db.insert(documentChunks).values({
      contractId: contractIds[1]!,
      documentS3Key: "contracts/RAG-N00024-23-C-5500.docx",
      chunkIndex: chunk.idx,
      sectionType: chunk.section as any,
      clauseNumber: chunk.clause,
      chunkText: chunk.text + " (Navy version)",
      embedding,
    });
  }

  await client.unsafe("SET session_replication_role = 'origin'");
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

// ─── RAG Service Tests ───────────────────────────────────────────────

describe("RAGService", () => {
  it("answerQuestion returns a structured answer with citations", async () => {
    const result = await ragService.answerQuestion(
      "What are the intellectual property rights?",
    );

    expect(result.answer).toBeDefined();
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.citations).toBeDefined();
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.contextTokensUsed).toBeGreaterThan(0);
  });

  it("citations reference actual document chunks", async () => {
    const result = await ragService.answerQuestion(
      "What are the deliverable requirements?",
    );

    expect(result.citations.length).toBeGreaterThan(0);

    for (const citation of result.citations) {
      expect(citation.chunkId).toBeDefined();
      expect(citation.chunkText).toBeDefined();
      expect(citation.chunkText.length).toBeGreaterThan(0);
      expect(citation.contractId).toBeDefined();
      expect(citation.contractNumber).toBeDefined();
      expect(citation.sectionType).toBeDefined();
      expect(typeof citation.similarityScore).toBe("number");
    }

    // Top citation should be deliverable-related
    const topCitation = result.citations[0]!;
    expect(topCitation.chunkText.toLowerCase()).toMatch(
      /deliverable|schedule|report/,
    );
  });

  it("analyzeClause returns risk assessment for deviating clause", async () => {
    const deviatingClause =
      "Notwithstanding FAR 52.249-1, contractor liability is limited to the total contract value. " +
      "The Government waives all consequential and indirect damages.";

    const analysis = await ragService.analyzeClause(
      deviatingClause,
      contractIds[0]!,
    );

    expect(analysis.riskLevel).toBeDefined();
    expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(analysis.riskLevel);
    expect(analysis.deviations).toBeDefined();
    expect(analysis.deviations.length).toBeGreaterThan(0);
    expect(analysis.justification).toBeDefined();
    expect(analysis.justification.length).toBeGreaterThan(0);
    expect(analysis.recommendations).toBeDefined();
    expect(analysis.similarClauses).toBeDefined();
  });

  it("summarizeContract returns a summary with key terms", async () => {
    const summary = await ragService.summarizeContract(contractIds[0]!);

    expect(summary.summary).toBeDefined();
    expect(summary.summary.length).toBeGreaterThan(0);
    expect(summary.keyTerms).toBeDefined();
    expect(Array.isArray(summary.keyTerms)).toBe(true);
    expect(summary.keyTerms.length).toBeGreaterThan(0);
    expect(summary.risks).toBeDefined();
    expect(Array.isArray(summary.risks)).toBe(true);
    expect(summary.obligations).toBeDefined();
    expect(Array.isArray(summary.obligations)).toBe(true);
  });

  it("MockLLMProvider returns valid structured responses", async () => {
    const llm = new MockLLMProvider();

    // Test ANSWER_QUESTION task
    const answerResponse = await llm.complete("TASK: ANSWER_QUESTION\nQuestion: test?");
    const parsed = JSON.parse(answerResponse);
    expect(parsed.answer).toBeDefined();
    expect(parsed.confidence).toBeDefined();
    expect(typeof parsed.confidence).toBe("number");

    // Test SUMMARIZE_CONTRACT task
    const summaryResponse = await llm.complete("TASK: SUMMARIZE_CONTRACT\nContext: ...");
    const summaryParsed = JSON.parse(summaryResponse);
    expect(summaryParsed.summary).toBeDefined();
    expect(summaryParsed.key_terms).toBeDefined();
    expect(summaryParsed.risks).toBeDefined();
    expect(summaryParsed.obligations).toBeDefined();

    // Test ANALYZE_CLAUSE task
    const clauseResponse = await llm.complete("TASK: ANALYZE_CLAUSE\nClause: ...");
    const clauseParsed = JSON.parse(clauseResponse);
    expect(clauseParsed.risk_level).toBeDefined();
    expect(clauseParsed.deviations).toBeDefined();
    expect(clauseParsed.justification).toBeDefined();
    expect(clauseParsed.recommendations).toBeDefined();
  });
});

// ─── API Endpoint Tests ──────────────────────────────────────────────

describe("Search & Ask API Endpoints", () => {
  it("POST /api/v1/search returns results with timing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/search",
      headers: authHeader(adminToken),
      payload: {
        query: "intellectual property rights",
        limit: 5,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.query_embedding_time_ms).toBeDefined();
    expect(body.search_time_ms).toBeDefined();

    // Top result should be IP-related
    expect(body.results[0].chunkText.toLowerCase()).toMatch(
      /intellectual property|data rights/,
    );
  });

  it("POST /api/v1/ask returns answer with citations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ask",
      headers: authHeader(adminToken),
      payload: {
        question: "What are the security requirements?",
        contract_id: contractIds[0],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.answer).toBeDefined();
    expect(typeof body.answer).toBe("string");
    expect(body.citations).toBeDefined();
    expect(Array.isArray(body.citations)).toBe(true);
    expect(body.confidence).toBeDefined();
    expect(typeof body.confidence).toBe("number");
  });
});
