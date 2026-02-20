import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  ContractIntelligenceAgent,
  parseIntelligenceResponse,
  computeConfidence,
  type ContractIntelligencePayload,
} from "../contract-intelligence.js";
import type { AgentTask, AgentDependencies } from "../../framework/base-agent.js";

// ─── Mock LLM responses ─────────────────────────────────────────────

const LLM_IP_ANSWER = JSON.stringify({
  answer:
    "Based on Contract FA8726-24-C-0042, Section H clause 52.227-14 (Rights in Data - General), " +
    "the Government is granted unlimited rights to all technical data developed under this contract. " +
    "This includes the right to use, disclose, reproduce, and prepare derivative works.",
  cited_sources: [1, 3],
  confidence: 0.92,
});

const LLM_OPTION_ANSWER = JSON.stringify({
  answer:
    "Option 2 on Contract FA8726-24-C-0042 expires on 2026-12-31. " +
    "The exercise deadline is 2026-09-30, and the option covers the period from 2026-01-01 to 2026-12-31.",
  cited_sources: [1],
  confidence: 0.88,
});

const LLM_UNRELATED_ANSWER = JSON.stringify({
  answer:
    "The contract documents mention weather forecasting capabilities under Contract XY1234-99-Z-0001 " +
    "which is not part of the available context.",
  cited_sources: [],
  confidence: 0.2,
});

const LLM_GENERIC_ANSWER = JSON.stringify({
  answer:
    "Based on the contract documents, the relevant information is contained in the referenced sections.",
  cited_sources: [1, 2],
  confidence: 0.85,
});

// ─── Test helpers ────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function createMockDeps(options?: {
  llmResponse?: string;
  chunks?: Array<{
    chunkId: string;
    chunkText: string;
    similarityScore: number;
    contractId: string;
    sectionType: string;
    clauseNumber: string | null;
  }>;
  contractContext?: Record<string, unknown>;
  optionRows?: unknown[];
}): AgentDependencies & { queryCalls: QueryCall[] } {
  const queryCalls: QueryCall[] = [];

  const defaultChunks = [
    {
      chunkId: "chunk-001",
      chunkText:
        "Intellectual property and data rights under clause 52.227-14. The Government shall have unlimited rights in technical data.",
      similarityScore: 0.91,
      contractId: "contract-001",
      sectionType: "SECTION_H",
      clauseNumber: "52.227-14",
    },
    {
      chunkId: "chunk-002",
      chunkText:
        "Deliverable schedule. Monthly status reports due by the 15th of each month.",
      similarityScore: 0.78,
      contractId: "contract-001",
      sectionType: "SECTION_F",
      clauseNumber: null,
    },
    {
      chunkId: "chunk-003",
      chunkText:
        "Rights in Other Than Commercial Technical Data and Computer Software (DFARS 252.227-7014). Contractor retains GPR for 5 years.",
      similarityScore: 0.85,
      contractId: "contract-001",
      sectionType: "SECTION_I",
      clauseNumber: "252.227-7014",
    },
    {
      chunkId: "chunk-004",
      chunkText:
        "Scope of work for systems engineering support. The contractor shall provide radar analysis.",
      similarityScore: 0.65,
      contractId: "contract-002",
      sectionType: "SECTION_C",
      clauseNumber: null,
    },
  ];

  const defaultContext = {
    contractId: "contract-001",
    contractNumber: "FA8726-24-C-0042",
    status: "ACTIVE",
    contractType: "CPFF",
    ceilingValue: "12500000.00",
    fundedValue: "5000000.00",
    awardingAgency: "USAF",
    popStart: "2024-01-01",
    popEnd: "2025-12-31",
  };

  const context2 = {
    contractId: "contract-002",
    contractNumber: "N00024-23-C-5500",
    status: "ACTIVE",
    contractType: "FFP",
    ceilingValue: "8000000.00",
    fundedValue: "8000000.00",
    awardingAgency: "US Navy",
    popStart: "2023-06-01",
    popEnd: "2026-05-31",
  };

  const queryFn = vi
    .fn()
    .mockImplementation((sql: string, _params: unknown[]) => {
      queryCalls.push({ sql, params: _params });

      if (sql.includes("contracts.contract_options")) {
        return options?.optionRows ?? [];
      }

      return [];
    });

  const getContractContextFn = vi
    .fn()
    .mockImplementation((contractId: string) => {
      if (contractId === "contract-001") {
        return Promise.resolve(options?.contractContext ?? defaultContext);
      }
      if (contractId === "contract-002") {
        return Promise.resolve(context2);
      }
      return Promise.reject(new Error("Contract not found"));
    });

  return {
    queryCalls,
    llm: {
      complete: vi.fn().mockResolvedValue(options?.llmResponse ?? LLM_IP_ANSWER),
    },
    vectorSearch: {
      search: vi.fn().mockResolvedValue(options?.chunks ?? defaultChunks),
    },
    database: {
      query: queryFn,
      getContractContext: getContractContextFn,
    },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
    fsm: {
      transition: vi.fn().mockResolvedValue("ACTIVE"),
      getAvailableTransitions: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeTask(overrides?: Partial<ContractIntelligencePayload>): AgentTask {
  return {
    id: "task-intel-001",
    agentName: "contract-intelligence",
    triggerType: "MANUAL",
    triggerPayload: {
      question: "What are our IP rights on contract FA8726-24-C-0042?",
      contractId: "contract-001",
      userId: "user-001",
      source: "dashboard",
      ...overrides,
    } as unknown as Record<string, unknown>,
    priority: "MEDIUM",
    createdAt: new Date(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("ContractIntelligenceAgent", () => {
  it("answers IP rights question citing IP-related clauses", async () => {
    const deps = createMockDeps({ llmResponse: LLM_IP_ANSWER });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(
      makeTask({ question: "What are our IP rights on contract FA8726-24-C-0042?" }),
    );

    expect(result.success).toBe(true);

    const data = result.data as any;
    expect(data.answer).toContain("52.227-14");
    expect(data.answer).toContain("unlimited rights");

    // Should cite IP-related chunks (source 1 and 3 from LLM response)
    expect(data.citations.length).toBeGreaterThan(0);
    const clauseNumbers = data.citations.map((c: any) => c.clauseNumber).filter(Boolean);
    expect(clauseNumbers).toContain("52.227-14");
  });

  it("answers option expiration question from structured data", async () => {
    const deps = createMockDeps({
      llmResponse: LLM_OPTION_ANSWER,
      optionRows: [
        {
          option_number: 1,
          option_start: "2025-01-01",
          option_end: "2025-12-31",
          exercise_deadline: "2025-09-30",
          status: "EXERCISED",
        },
        {
          option_number: 2,
          option_start: "2026-01-01",
          option_end: "2026-12-31",
          exercise_deadline: "2026-09-30",
          status: "NOT_EXERCISED",
        },
      ],
    });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(
      makeTask({ question: "When does option 2 expire?" }),
    );

    expect(result.success).toBe(true);

    const data = result.data as any;
    expect(data.answer).toContain("2026-12-31");
    expect(data.answer).toContain("Option 2");

    // LLM should have been called with structured data including options
    const llmPrompt = (deps.llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(llmPrompt).toContain("Option 2");
    expect(llmPrompt).toContain("2026-12-31");
  });

  it("returns no-information response for non-existent contract", async () => {
    const deps = createMockDeps({
      chunks: [], // No chunks match
    });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(
      makeTask({
        question: "What is the scope of contract FAKE-99-X-0000?",
        contractId: "contract-nonexistent",
      }),
    );

    expect(result.success).toBe(true);

    const data = result.data as any;
    expect(data.answer).toContain("don't have enough information");
    expect(data.citations).toEqual([]);
    expect(data.confidence).toBe(0);
  });

  it("citations reference actual chunks from the search", async () => {
    const customChunks = [
      {
        chunkId: "chunk-abc",
        chunkText: "The contractor shall deliver monthly status reports.",
        similarityScore: 0.88,
        contractId: "contract-001",
        sectionType: "SECTION_F",
        clauseNumber: null,
      },
      {
        chunkId: "chunk-def",
        chunkText: "FAR 52.212-4 governs commercial terms.",
        similarityScore: 0.72,
        contractId: "contract-001",
        sectionType: "SECTION_I",
        clauseNumber: "52.212-4",
      },
    ];

    const deps = createMockDeps({
      chunks: customChunks,
      llmResponse: LLM_GENERIC_ANSWER,
    });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(
      makeTask({ question: "What are the deliverable requirements?" }),
    );

    const data = result.data as any;
    expect(data.citations.length).toBe(2);

    // Each citation should match an actual chunk
    expect(data.citations[0].chunkId).toBe("chunk-abc");
    expect(data.citations[0].chunkText).toContain("monthly status reports");
    expect(data.citations[0].contractNumber).toBe("FA8726-24-C-0042");

    expect(data.citations[1].chunkId).toBe("chunk-def");
    expect(data.citations[1].clauseNumber).toBe("52.212-4");
  });

  it("confidence score reflects similarity scores of cited chunks", async () => {
    const chunks = [
      {
        chunkId: "c1",
        chunkText: "High relevance chunk about IP rights.",
        similarityScore: 0.95,
        contractId: "contract-001",
        sectionType: "SECTION_H",
        clauseNumber: "52.227-14",
      },
      {
        chunkId: "c2",
        chunkText: "Medium relevance chunk.",
        similarityScore: 0.75,
        contractId: "contract-001",
        sectionType: "SECTION_C",
        clauseNumber: null,
      },
      {
        chunkId: "c3",
        chunkText: "Lower relevance chunk.",
        similarityScore: 0.60,
        contractId: "contract-001",
        sectionType: "SECTION_B",
        clauseNumber: null,
      },
    ];

    // LLM cites sources 1 and 3 (0.95 and 0.60) → avg = 0.775
    const llmResponse = JSON.stringify({
      answer: "The IP rights are governed by clause 52.227-14.",
      cited_sources: [1, 3],
      confidence: 0.8,
    });

    const deps = createMockDeps({ chunks, llmResponse });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(makeTask());
    const data = result.data as any;

    // Confidence should be average of cited chunks' similarity scores
    expect(data.confidence).toBeCloseTo(0.775, 2);
  });

  it("anti-hallucination: low confidence for unrelated topic", async () => {
    // All chunks have low similarity scores
    const lowChunks = [
      {
        chunkId: "c1",
        chunkText: "Standard FAR clause terms.",
        similarityScore: 0.35,
        contractId: "contract-001",
        sectionType: "SECTION_I",
        clauseNumber: null,
      },
      {
        chunkId: "c2",
        chunkText: "Pricing information.",
        similarityScore: 0.30,
        contractId: "contract-001",
        sectionType: "SECTION_B",
        clauseNumber: null,
      },
    ];

    const deps = createMockDeps({ chunks: lowChunks });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(
      makeTask({ question: "What is the weather forecast for next week?" }),
    );

    const data = result.data as any;
    // No chunks pass the 0.5 threshold → "no information" response
    expect(data.answer).toContain("don't have enough information");
    expect(data.confidence).toBe(0);
    expect(data.citations).toEqual([]);
  });

  it("contract-scoped search only passes contractId to vector search", async () => {
    const deps = createMockDeps();
    const agent = new ContractIntelligenceAgent(deps);

    await agent.execute(
      makeTask({
        question: "What is the ceiling value?",
        contractId: "contract-001",
      }),
    );

    const searchCall = (deps.vectorSearch.search as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(searchCall![1]).toEqual({
      contractId: "contract-001",
      limit: 10,
    });
  });

  it("logs the full question/answer to audit", async () => {
    const deps = createMockDeps({ llmResponse: LLM_IP_ANSWER });
    const agent = new ContractIntelligenceAgent(deps);

    await agent.execute(
      makeTask({
        question: "What are our IP rights?",
        contractId: "contract-001",
        source: "dashboard",
      }),
    );

    const auditLog = deps.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLog).toHaveBeenCalledTimes(2);

    // First call: RUNNING
    const runEntry = auditLog.mock.calls[0]![0];
    expect(runEntry.status).toBe("RUNNING");
    expect(runEntry.inputSummary.question).toBe("What are our IP rights?");
    expect(runEntry.inputSummary.contractId).toBe("contract-001");
    expect(runEntry.inputSummary.source).toBe("dashboard");

    // Second call: SUCCESS
    const successEntry = auditLog.mock.calls[1]![0];
    expect(successEntry.status).toBe("SUCCESS");
    expect(successEntry.outputSummary.answer).toContain("52.227-14");
    expect(typeof successEntry.outputSummary.confidence).toBe("number");
    expect(typeof successEntry.outputSummary.citationCount).toBe("number");
  });

  it("flags answer referencing contract numbers not in context", async () => {
    const deps = createMockDeps({ llmResponse: LLM_UNRELATED_ANSWER });
    const agent = new ContractIntelligenceAgent(deps);

    const result = await agent.execute(makeTask());

    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("not in context");

    const data = result.data as any;
    expect(data.flaggedForReview).toBe(true);
  });
});

// ─── Unit tests for helpers ──────────────────────────────────────────

describe("parseIntelligenceResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseIntelligenceResponse(LLM_IP_ANSWER);
    expect(result.answer).toContain("52.227-14");
    expect(result.cited_sources).toEqual([1, 3]);
    expect(result.confidence).toBe(0.92);
  });

  it("handles non-JSON response gracefully", () => {
    const result = parseIntelligenceResponse("This is a plain text answer.");
    expect(result.answer).toBe("This is a plain text answer.");
    expect(result.cited_sources).toEqual([]);
    expect(result.confidence).toBe(0.3);
  });
});

describe("computeConfidence", () => {
  it("averages cited chunk scores", () => {
    const chunks = [
      { similarityScore: 0.9 },
      { similarityScore: 0.7 },
      { similarityScore: 0.5 },
    ];
    // Cite sources 1 and 3 → scores 0.9 and 0.5 → avg 0.7
    expect(computeConfidence(chunks, [1, 3])).toBeCloseTo(0.7, 2);
  });

  it("averages all chunks when no citations", () => {
    const chunks = [
      { similarityScore: 0.8 },
      { similarityScore: 0.6 },
    ];
    expect(computeConfidence(chunks, [])).toBeCloseTo(0.7, 2);
  });

  it("returns 0 for empty chunks", () => {
    expect(computeConfidence([], [])).toBe(0);
  });
});

// ─── API endpoint integration test ──────────────────────────────────

describe("POST /api/v1/ask endpoint", () => {
  let app: any;
  let adminToken: string;
  let db: any;
  let client: any;
  let contractId: string;

  beforeAll(async () => {
    // Dynamic imports — only resolve when DB is available
    const pg = await import("postgres");
    const drz = await import("drizzle-orm/postgres-js");
    const mig = await import("drizzle-orm/postgres-js/migrator");
    const schema = await import("../../../../api/src/db/schema.js");
    const schemaVectors = await import("../../../../api/src/db/schema-vectors.js");
    const server = await import("../../../../api/src/server.js");
    const auth = await import("../../../../api/src/middleware/auth.js");
    const llm = await import("../../../../api/src/services/llm-provider.js");

    const TEST_DB_URL =
      process.env["DATABASE_URL"] ??
      "postgresql://forge:forge@localhost:5433/forge_test";

    client = pg.default(TEST_DB_URL, { max: 5 });
    db = drz.drizzle(client);

    await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

    const migrationsPath = new URL(
      "../../../../api/src/db/migrations",
      import.meta.url,
    ).pathname;
    await mig.migrate(db, { migrationsFolder: migrationsPath });

    // Topic embedding helper (simple orthogonal basis vector)
    function topicEmbedding(topicIndex: number, dims = 768): number[] {
      const vec = new Array(dims).fill(0.01);
      vec[topicIndex] = 1.0;
      const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
      return vec.map((v: number) => v / norm);
    }

    // Deterministic test embedding client
    const embeddingClient = {
      async embed(text: string): Promise<number[]> {
        const lower = text.toLowerCase();
        if (lower.includes("intellectual property") || lower.includes("ip rights") || lower.includes("data rights"))
          return topicEmbedding(0);
        if (lower.includes("option") || lower.includes("expire"))
          return topicEmbedding(1);
        if (lower.includes("security") || lower.includes("cybersecurity"))
          return topicEmbedding(2);
        return topicEmbedding(3);
      },
    };

    const mockLLM = new llm.MockLLMProvider();

    app = await server.buildApp(db, { embeddingClient, llmProvider: mockLLM });
    adminToken = auth.createTestToken(app, { role: "admin" });

    // Seed a contract with chunks
    const [row] = await db
      .insert(schema.contracts)
      .values({
        contractNumber: "INTEL-FA8726-24-C-0042",
        contractType: "CPFF" as const,
        awardingAgency: "USAF",
        contractingOfficerName: "Test Officer",
        contractingOfficerEmail: "test@gov.mil",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
        ceilingValue: "12500000.00",
        fundedValue: "5000000.00",
        status: "ACTIVE",
      })
      .returning();
    contractId = row!.id;

    // Insert chunks
    const chunks = [
      { idx: 0, section: "SECTION_H", clause: "52.227-14", text: "Intellectual property and data rights. The Government shall have unlimited rights in technical data.", topic: 0 },
      { idx: 1, section: "SECTION_C", clause: null, text: "Scope of work for systems engineering and radar analysis support.", topic: 3 },
      { idx: 2, section: "SECTION_H", clause: null, text: "Security requirements. SECRET clearance. NIST SP 800-171 compliance.", topic: 2 },
    ];

    for (const chunk of chunks) {
      await db.insert(schemaVectors.documentChunks).values({
        contractId,
        documentS3Key: "contracts/INTEL-FA8726-24-C-0042.docx",
        chunkIndex: chunk.idx,
        sectionType: chunk.section as any,
        clauseNumber: chunk.clause,
        chunkText: chunk.text,
        embedding: topicEmbedding(chunk.topic),
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (client) {
      await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
      await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
      await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
      await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
      await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");
      await client.end();
    }
  });

  it("POST /api/v1/ask returns answer with citations end-to-end", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ask",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        question: "What are the intellectual property and data rights?",
        contract_id: contractId,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.answer).toBeDefined();
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.citations).toBeDefined();
    expect(Array.isArray(body.citations)).toBe(true);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(typeof body.confidence).toBe("number");

    // Top citation should be IP-related
    const topCitation = body.citations[0];
    expect(topCitation.chunkText.toLowerCase()).toMatch(
      /intellectual property|data rights/,
    );
  });
});
