import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { contracts } from "../../db/schema.js";
import { documentChunks, entityAnnotations } from "../../db/schema-vectors.js";
import {
  VectorSearchService,
  type EmbeddingClient,
} from "../vector-search-service.js";

// ─── Test config ─────────────────────────────────────────────────────

const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let service: VectorSearchService;

// ─── Topic-based deterministic embeddings ────────────────────────────

const TOPICS = {
  ip: 0,
  deliverable: 1,
  far_clause: 2,
  pricing: 3,
  pop: 4,
  security: 5,
  scope: 6,
  quality: 7,
  subcontracting: 8,
  termination: 9,
  changes: 10,
  personnel: 11,
  options: 12,
  travel: 13,
  disputes: 14,
  unrelated: 15,
} as const;

function topicEmbedding(topicIndex: number, dims = 768): number[] {
  const vec = new Array(dims).fill(0.01);
  vec[topicIndex] = 1.0;
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}

// Mock embedding client — maps query text to topic vectors
class TestEmbeddingClient implements EmbeddingClient {
  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();

    if (lower.includes("intellectual property") || lower.includes("ip rights") || lower.includes("data rights"))
      return topicEmbedding(TOPICS.ip);
    if (lower.includes("deliverable") || lower.includes("schedule") || lower.includes("reporting"))
      return topicEmbedding(TOPICS.deliverable);
    if (lower.includes("far clause") || lower.includes("52.212"))
      return topicEmbedding(TOPICS.far_clause);
    if (lower.includes("pricing") || lower.includes("ceiling") || lower.includes("cost"))
      return topicEmbedding(TOPICS.pricing);
    if (lower.includes("period of performance") || lower.includes("pop"))
      return topicEmbedding(TOPICS.pop);
    if (lower.includes("security") || lower.includes("cybersecurity"))
      return topicEmbedding(TOPICS.security);
    if (lower.includes("scope of work") || lower.includes("statement of work"))
      return topicEmbedding(TOPICS.scope);
    if (lower.includes("quality"))
      return topicEmbedding(TOPICS.quality);
    if (lower.includes("subcontract"))
      return topicEmbedding(TOPICS.subcontracting);
    if (lower.includes("terminat"))
      return topicEmbedding(TOPICS.termination);
    if (lower.includes("change order"))
      return topicEmbedding(TOPICS.changes);
    if (lower.includes("personnel") || lower.includes("key staff"))
      return topicEmbedding(TOPICS.personnel);
    if (lower.includes("option period"))
      return topicEmbedding(TOPICS.options);
    if (lower.includes("weather") || lower.includes("banana"))
      return topicEmbedding(TOPICS.unrelated);

    // Default: slight mix of all
    return topicEmbedding(TOPICS.scope);
  }
}

// ─── Seed data ───────────────────────────────────────────────────────

interface SeedContract {
  id?: string;
  contractNumber: string;
  contractType: string;
  awardingAgency: string;
}

interface SeedChunk {
  contractIndex: number;
  chunkIndex: number;
  sectionType: string;
  clauseNumber: string | null;
  chunkText: string;
  topic: keyof typeof TOPICS;
}

const SEED_CONTRACTS: SeedContract[] = [
  {
    contractNumber: "FA8726-24-C-0042",
    contractType: "FFP",
    awardingAgency: "US Air Force",
  },
  {
    contractNumber: "N00024-23-C-5500",
    contractType: "CPFF",
    awardingAgency: "US Navy",
  },
  {
    contractNumber: "70CDCR24C00000001",
    contractType: "T_AND_M",
    awardingAgency: "DHS",
  },
];

const SEED_CHUNKS: SeedChunk[] = [
  // Contract 0 (Air Force FFP)
  { contractIndex: 0, chunkIndex: 0, sectionType: "SECTION_H", clauseNumber: "52.227-14", chunkText: "Intellectual property rights and data rights. The Government shall have unlimited rights in all data delivered under this contract. Technical data shall be provided in accordance with DFARS 252.227-7013.", topic: "ip" },
  { contractIndex: 0, chunkIndex: 1, sectionType: "SECTION_F", clauseNumber: null, chunkText: "Deliverable requirements and schedule. The contractor shall deliver monthly status reports by the 15th of each month. A final technical report is due 30 days after contract completion.", topic: "deliverable" },
  { contractIndex: 0, chunkIndex: 2, sectionType: "SECTION_I", clauseNumber: "52.212-4", chunkText: "FAR clause 52.212-4 Contract Terms and Conditions — Commercial Products and Commercial Services. This clause incorporates standard commercial contract terms including inspection, acceptance, and payment provisions.", topic: "far_clause" },
  { contractIndex: 0, chunkIndex: 3, sectionType: "SECTION_B", clauseNumber: null, chunkText: "Pricing and ceiling value. The total ceiling value of this contract is $12,500,000.00. The contract is incrementally funded with a current funded value of $5,000,000.00.", topic: "pricing" },
  { contractIndex: 0, chunkIndex: 4, sectionType: "SECTION_F", clauseNumber: null, chunkText: "Period of performance. The base period of performance is from January 1, 2024 through December 31, 2025. Option periods may extend performance through December 31, 2027.", topic: "pop" },
  { contractIndex: 0, chunkIndex: 5, sectionType: "SECTION_H", clauseNumber: null, chunkText: "Security requirements. All contractor personnel must possess a SECRET clearance. The contractor shall comply with NIST SP 800-171 for handling of Controlled Unclassified Information.", topic: "security" },
  { contractIndex: 0, chunkIndex: 6, sectionType: "SECTION_C", clauseNumber: null, chunkText: "Scope of work and statement of work. The contractor shall provide systems engineering and technical assistance in support of next-generation radar systems development.", topic: "scope" },

  // Contract 1 (Navy CPFF)
  { contractIndex: 1, chunkIndex: 0, sectionType: "SECTION_H", clauseNumber: "52.227-14", chunkText: "IP provisions for Navy research contract. The contractor retains limited rights to background intellectual property. Government receives unlimited rights in foreground IP developed under this contract.", topic: "ip" },
  { contractIndex: 1, chunkIndex: 1, sectionType: "SECTION_B", clauseNumber: null, chunkText: "Cost accounting and fee structure. The estimated cost is $8,000,000 with a fixed fee of $640,000. Cost accounting standards CAS 401 through CAS 418 apply to this contract.", topic: "pricing" },
  { contractIndex: 1, chunkIndex: 2, sectionType: "SECTION_E", clauseNumber: null, chunkText: "Quality assurance provisions. The contractor shall maintain a quality management system in accordance with ISO 9001:2015. Government quality assurance surveillance shall be performed at the contractor's facility.", topic: "quality" },
  { contractIndex: 1, chunkIndex: 3, sectionType: "SECTION_H", clauseNumber: null, chunkText: "Subcontracting plan requirements. The contractor shall submit a small business subcontracting plan with a goal of 30% small business participation including 5% to HUBZone firms.", topic: "subcontracting" },
  { contractIndex: 1, chunkIndex: 4, sectionType: "SECTION_I", clauseNumber: "52.249-1", chunkText: "Termination for convenience of the Government. The Government may terminate this contract in whole or in part at any time by written notice. Upon termination, the contractor shall stop work and deliver all completed items.", topic: "termination" },
  { contractIndex: 1, chunkIndex: 5, sectionType: "SECTION_I", clauseNumber: "52.243-1", chunkText: "Change orders. The Contracting Officer may issue written change orders at any time. Changes may include modifications to drawings, designs, specifications, or method of performance.", topic: "changes" },

  // Contract 2 (DHS T&M)
  { contractIndex: 2, chunkIndex: 0, sectionType: "SECTION_H", clauseNumber: null, chunkText: "Cybersecurity requirements. All systems shall comply with FISMA and FedRAMP requirements. The contractor shall maintain an Authority to Operate (ATO) for all systems handling government data.", topic: "security" },
  { contractIndex: 2, chunkIndex: 1, sectionType: "SECTION_B", clauseNumber: null, chunkText: "Labor rates and categories. Senior Engineer: $185/hour, Engineer: $145/hour, Analyst: $110/hour. Rates are ceiling rates not to exceed for the base period.", topic: "pricing" },
  { contractIndex: 2, chunkIndex: 2, sectionType: "SECTION_F", clauseNumber: null, chunkText: "Reporting requirements and deliverable schedule. Weekly status reports are due every Monday. Monthly financial reports are due by the 5th business day of each month.", topic: "deliverable" },
  { contractIndex: 2, chunkIndex: 3, sectionType: "SECTION_H", clauseNumber: null, chunkText: "Key personnel requirements. The Program Manager and Lead Systems Engineer are designated key personnel. Substitution requires 30 days advance written notice and Government approval.", topic: "personnel" },
  { contractIndex: 2, chunkIndex: 4, sectionType: "SECTION_B", clauseNumber: null, chunkText: "Option periods. Option Period 1: January 1, 2026 through December 31, 2026. Option Period 2: January 1, 2027 through December 31, 2027. Each option must be exercised 60 days prior to expiration.", topic: "options" },
  { contractIndex: 2, chunkIndex: 5, sectionType: "SECTION_B", clauseNumber: null, chunkText: "Travel requirements. The contractor is authorized up to 24 trips per year to Washington DC. Travel costs shall be reimbursed in accordance with the Federal Travel Regulation.", topic: "travel" },
  { contractIndex: 2, chunkIndex: 6, sectionType: "SECTION_I", clauseNumber: null, chunkText: "Dispute resolution. All disputes shall be resolved in accordance with the Contract Disputes Act. The contractor shall proceed diligently with performance pending resolution of any dispute.", topic: "disputes" },
];

// Track seeded contract IDs
let contractIds: string[] = [];

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

  // Create the service with mock embedding client
  service = new VectorSearchService(db, new TestEmbeddingClient());

  // Seed data
  await seedData();
}, 60_000);

afterAll(async () => {
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");
  await client.end();
});

async function seedData() {
  // Disable audit triggers for seeding
  await client.unsafe("SET session_replication_role = 'replica'");

  // Insert contracts
  contractIds = [];
  for (const c of SEED_CONTRACTS) {
    const [row] = await db
      .insert(contracts)
      .values({
        contractNumber: c.contractNumber,
        contractType: c.contractType as "FFP" | "CPFF" | "T_AND_M",
        awardingAgency: c.awardingAgency,
        contractingOfficerName: "Test Officer",
        contractingOfficerEmail: "test@gov.mil",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
        ceilingValue: "10000000.00",
        fundedValue: "5000000.00",
        status: "ACTIVE",
      })
      .returning();
    contractIds.push(row!.id);
  }

  // Insert chunks with topic-based embeddings
  for (const chunk of SEED_CHUNKS) {
    const contractId = contractIds[chunk.contractIndex]!;
    const embedding = topicEmbedding(TOPICS[chunk.topic]);

    const [insertedChunk] = await db
      .insert(documentChunks)
      .values({
        contractId,
        documentS3Key: `contracts/${SEED_CONTRACTS[chunk.contractIndex]!.contractNumber}.docx`,
        chunkIndex: chunk.chunkIndex,
        sectionType: chunk.sectionType as any,
        clauseNumber: chunk.clauseNumber,
        chunkText: chunk.chunkText,
        embedding,
        metadataJson: { topic: chunk.topic },
      })
      .returning();

    // Add entity annotations for some chunks
    if (chunk.clauseNumber) {
      await db.insert(entityAnnotations).values({
        chunkId: insertedChunk!.id,
        entityType: "FAR_CLAUSE",
        entityValue: chunk.clauseNumber,
        startChar: 0,
        endChar: chunk.clauseNumber.length,
        confidence: "0.95",
        modelVersion: "test-v0.1",
      });
    }
  }

  await client.unsafe("SET session_replication_role = 'origin'");
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("VectorSearchService", () => {
  it("returns results sorted by similarity score (highest first)", async () => {
    const results = await service.search("intellectual property rights", {
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);

    // Results should be sorted descending by similarity
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.similarityScore).toBeGreaterThanOrEqual(
        results[i]!.similarityScore,
      );
    }
  });

  it("filters results by contract_id", async () => {
    const targetContractId = contractIds[0]!;

    const results = await service.search("scope of work", {
      contractId: targetContractId,
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);

    // All results should belong to the specified contract
    for (const r of results) {
      expect(r.contractId).toBe(targetContractId);
    }
  });

  it("filters results by section_type", async () => {
    const results = await service.search("pricing ceiling value", {
      sectionType: "SECTION_B",
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.sectionType).toBe("SECTION_B");
    }
  });

  it("returns the IP chunk first when querying 'intellectual property rights'", async () => {
    const results = await service.search("intellectual property rights", {
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    // Top result should be one of the IP-related chunks
    const topResult = results[0]!;
    expect(topResult.chunkText.toLowerCase()).toMatch(
      /intellectual property|ip|data rights/,
    );
    expect(topResult.similarityScore).toBeGreaterThan(0.9);
  });

  it("searchSimilarClauses returns related clauses from SECTION_I", async () => {
    const clauseText =
      "The contractor shall comply with the terms and conditions of FAR 52.212-4.";

    const results = await service.searchSimilarClauses(clauseText, 5);

    expect(results.length).toBeGreaterThan(0);

    // All results should be from SECTION_I (clause section)
    for (const r of results) {
      expect(r.sectionType).toBe("SECTION_I");
    }
  });

  it("getContractContext returns a coherent context window", async () => {
    const context = await service.getContractContext(
      contractIds[0]!,
      "intellectual property rights",
      6,
    );

    expect(context.contractId).toBe(contractIds[0]!);
    expect(context.chunks.length).toBeGreaterThan(0);
    expect(context.chunks.length).toBeLessThanOrEqual(6);
    expect(context.totalTokensEstimate).toBeGreaterThan(0);

    // Chunks should be sorted by chunk_index (document order)
    for (let i = 1; i < context.chunks.length; i++) {
      expect(context.chunks[i]!.chunkIndex).toBeGreaterThanOrEqual(
        context.chunks[i - 1]!.chunkIndex,
      );
    }
  });

  it("returns low similarity scores for a completely unrelated query", async () => {
    const results = await service.search(
      "weather forecast for banana smoothie recipe",
      { limit: 5 },
    );

    // Results exist (pgvector always returns nearest) but with low scores
    expect(results.length).toBeGreaterThan(0);

    // All scores should be well below the relevant threshold
    for (const r of results) {
      expect(r.similarityScore).toBeLessThan(0.5);
    }
  });
});
