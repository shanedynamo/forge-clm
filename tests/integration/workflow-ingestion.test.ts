/**
 * Integration test: Contract Ingestion Workflow
 *
 * S3 event → download doc → NLP pipeline → store contract + clauses
 * → store chunks → trigger clause-analysis + compliance-monitor
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import {
  ContractIngestionAgent,
  ArcadeClient,
} from "@forge/agents";
import type { NlpPipelineClient, IngestionResponse, S3EventPayload } from "@forge/agents";
import {
  connectTestDb,
  setupSchema,
  cleanTables,
  teardownSchema,
  createDbProvider,
  createAuditProvider,
  createMockLlm,
  createMockVectorSearch,
  createMockFsm,
  createTask,
  seedContract,
} from "./helpers.js";

// ─── Fixtures ───────────────────────────────────────────────────────

let client: ReturnType<typeof postgres>;

function makeMockNlp(overrides: Partial<IngestionResponse> = {}): NlpPipelineClient {
  return {
    ingest: vi.fn(async (): Promise<IngestionResponse> => ({
      result: {
        contract_id: "nlp-generated-id",
        s3_key: "contracts/FA8726-24-C-0042.pdf",
        document_type: "pdf",
        text_length: 45000,
        chunk_count: 32,
        entity_count: 18,
        chunks_stored: 32,
        annotations_stored: 18,
        metadata: {
          contract_number: "FA8726-24-C-0042",
          ceiling_value: "2500000.00",
          funded_value: "1800000.00",
          pop_start: "2025-01-01",
          pop_end: "2026-12-31",
          naics_code: "541330",
          psc_code: "R425",
          security_level: "CUI",
          cage_code: "3ABC5",
          uei_number: "ABCD1234EFG",
          contracting_officer_name: "Maj. Jane Smith",
          far_clauses: ["52.204-21", "52.215-1", "52.232-33"],
          dfars_clauses: ["252.204-7012", "252.227-7013"],
        },
        duration_ms: 3200,
      },
      quality: {
        issues: [],
        needs_human_review: false,
        review_reasons: [],
        entity_count: 18,
        chunk_count: 32,
      },
      ...overrides,
    })),
  };
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const conn = connectTestDb();
  client = conn.client;
  await setupSchema(client);
}, 120_000);

afterAll(async () => {
  await teardownSchema(client);
});

beforeEach(async () => {
  await cleanTables(client);
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("Contract Ingestion Workflow", () => {
  it("ingests a new contract PDF: creates contract, clauses, triggers downstream agents", async () => {
    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const fsm = createMockFsm();
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const mockNlp = makeMockNlp();

    const agent = new ContractIngestionAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm,
      },
      { mcp, nlp: mockNlp, config: { maxRetries: 0, retryDelayMs: 0 } },
    );

    const payload: S3EventPayload = {
      bucket: "forge-documents",
      key: "contracts/FA8726-24-C-0042.pdf",
      eventType: "created",
    };

    const task = createTask("contract-ingestion", payload as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    // ── Verification 1: Agent succeeded ─────────────────────────
    expect(result.success).toBe(true);
    expect(result.data?.isModification).toBe(false);
    expect(result.data?.chunkCount).toBe(32);
    expect(result.data?.entityCount).toBe(18);

    // ── Verification 2: S3 download was attempted ───────────────
    const s3Calls = mcpSpy.mock.calls.filter(
      ([name]) => name === "s3.getObject",
    );
    expect(s3Calls.length).toBe(1);
    expect(s3Calls[0]![1]).toEqual({
      bucket: "forge-documents",
      key: "contracts/FA8726-24-C-0042.pdf",
    });

    // ── Verification 3: NLP pipeline was called ─────────────────
    expect(mockNlp.ingest).toHaveBeenCalledWith(
      "contracts/FA8726-24-C-0042.pdf",
      "pdf",
    );

    // ── Verification 4: Contract created in DB ──────────────────
    const contracts = await client.unsafe(
      "SELECT * FROM contracts.contracts WHERE contract_number = 'FA8726-24-C-0042'",
    );
    expect(contracts.length).toBe(1);
    const contract = contracts[0] as any;
    expect(contract.ceiling_value).toBe("2500000.00");
    expect(contract.funded_value).toBe("1800000.00");
    expect(contract.naics_code).toBe("541330");
    expect(contract.security_level).toBe("CUI");
    expect(contract.contracting_officer_name).toBe("Maj. Jane Smith");
    expect(contract.s3_document_key).toBe("contracts/FA8726-24-C-0042.pdf");

    // ── Verification 5: FSM transition called ───────────────────
    expect(fsm.transition).toHaveBeenCalledWith(
      "PRIME_CONTRACT",
      contract.id,
      "AWARDED",
      "system",
      "system",
    );

    // ── Verification 6: Clauses stored ──────────────────────────
    const clauses = await client.unsafe(
      "SELECT * FROM contracts.contract_clauses WHERE contract_id = $1 ORDER BY clause_number",
      [contract.id],
    );
    expect(clauses.length).toBe(5); // 3 FAR + 2 DFARS

    const farClauses = clauses.filter((c: any) => c.clause_type === "FAR");
    const dfarsClauses = clauses.filter((c: any) => c.clause_type === "DFARS");
    expect(farClauses.length).toBe(3);
    expect(dfarsClauses.length).toBe(2);
    expect(farClauses.map((c: any) => c.clause_number).sort()).toEqual([
      "52.204-21",
      "52.215-1",
      "52.232-33",
    ]);

    // ── Verification 7: Downstream agents triggered ─────────────
    // clause-analysis trigger
    expect(result.data?.downstreamAgents).toContain("clause-analysis");
    // compliance-monitor trigger (because POP dates exist)
    expect(result.data?.downstreamAgents).toContain("compliance-monitor");

    // ── Verification 8: Audit log entries ───────────────────────
    const auditRows = await client.unsafe(
      `SELECT * FROM audit.agent_execution_log WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(auditRows.length).toBe(2);
    expect((auditRows[0] as any).status).toBe("RUNNING");
    expect((auditRows[1] as any).status).toBe("SUCCESS");
  });

  it("processes a modification document: finds parent, diffs clauses, creates mod record", async () => {
    // Seed parent contract first
    const parentId = await seedContract(client, {
      contract_number: "FA8726-24-C-0042",
      status: "ACTIVE",
    });

    // Seed existing clauses on parent
    await client.unsafe(
      `INSERT INTO contracts.contract_clauses
       (contract_id, clause_number, clause_title, clause_type, risk_category)
       VALUES ($1, '52.204-21', '52.204-21', 'FAR', 'UNASSESSED'),
              ($1, '52.215-1', '52.215-1', 'FAR', 'UNASSESSED')`,
      [parentId],
    );

    // NLP returns modified clause set (added 52.232-33, kept 52.204-21, removed 52.215-1)
    const modNlp = makeMockNlp({
      result: {
        contract_id: "nlp-mod-id",
        s3_key: "contracts/mods/FA8726-mod-01.pdf",
        document_type: "pdf",
        text_length: 12000,
        chunk_count: 8,
        entity_count: 5,
        chunks_stored: 8,
        annotations_stored: 5,
        metadata: {
          contract_number: "FA8726-24-C-0042",
          ceiling_value: "3000000.00",
          funded_value: "2200000.00",
          pop_start: "2025-01-01",
          pop_end: "2027-06-30",
          naics_code: null,
          psc_code: null,
          security_level: null,
          cage_code: null,
          uei_number: null,
          contracting_officer_name: null,
          far_clauses: ["52.204-21", "52.232-33"],
          dfars_clauses: ["252.204-7012"],
        },
        duration_ms: 1500,
      },
    });

    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const fsm = createMockFsm();
    const mcp = new ArcadeClient({ mode: "mock" });

    const agent = new ContractIngestionAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm,
      },
      { mcp, nlp: modNlp, config: { maxRetries: 0, retryDelayMs: 0 } },
    );

    const payload: S3EventPayload = {
      bucket: "forge-documents",
      key: "contracts/mods/FA8726-mod-01.pdf",
      eventType: "created",
    };

    const task = createTask("contract-ingestion", payload as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    // ── Verification 1: Identified as modification ──────────────
    expect(result.success).toBe(true);
    expect(result.data?.isModification).toBe(true);
    expect(result.data?.contractId).toBe(parentId);

    // ── Verification 2: Modification record created ─────────────
    const mods = await client.unsafe(
      "SELECT * FROM contracts.modifications WHERE contract_id = $1",
      [parentId],
    );
    expect(mods.length).toBe(1);
    expect((mods[0] as any).status).toBe("DRAFT");
    expect((mods[0] as any).s3_document_key).toBe("contracts/mods/FA8726-mod-01.pdf");

    // ── Verification 3: MOD FSM transition called ───────────────
    expect(fsm.transition).toHaveBeenCalledWith(
      "MODIFICATION",
      (mods[0] as any).id,
      "MOD_IDENTIFIED",
      "system",
      "system",
    );

    // ── Verification 4: Clause diff computed ────────────────────
    const clauseDiff = result.data?.clauseDiff as any;
    expect(clauseDiff).toBeDefined();
    // Added: 52.232-33, 252.204-7012
    expect(clauseDiff.added).toBe(2);
    // Removed: 52.215-1
    expect(clauseDiff.removed).toBe(1);

    // ── Verification 5: Downstream includes flowdown-generator ──
    expect(result.data?.downstreamAgents).toContain("flowdown-generator");
    expect(result.data?.downstreamAgents).toContain("clause-analysis");
  });

  it("rejects unsupported file types", async () => {
    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const mockNlp = makeMockNlp();

    const agent = new ContractIngestionAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm: createMockFsm(),
      },
      { mcp: new ArcadeClient({ mode: "mock" }), nlp: mockNlp, config: { maxRetries: 0, retryDelayMs: 0 } },
    );

    const task = createTask("contract-ingestion", {
      bucket: "forge-documents",
      key: "contracts/readme.txt",
      eventType: "created",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported file type");
    // NLP should NOT have been called
    expect(mockNlp.ingest).not.toHaveBeenCalled();
  });

  it("creates quality review Jira ticket when NLP reports issues", async () => {
    const qualityNlp = makeMockNlp({
      quality: {
        issues: [
          { severity: "ERROR", code: "MISSING_SIGNATURE", message: "Signature block not found", details: {} },
          { severity: "WARNING", code: "LOW_CONFIDENCE", message: "OCR confidence below threshold", details: {} },
        ],
        needs_human_review: true,
        review_reasons: ["Missing signature block", "Low OCR confidence"],
        entity_count: 5,
        chunk_count: 10,
      },
    });

    const dbProvider = createDbProvider(client);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new ContractIngestionAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: createAuditProvider(client),
        fsm: createMockFsm(),
      },
      { mcp, nlp: qualityNlp, config: { maxRetries: 0, retryDelayMs: 0 } },
    );

    const task = createTask("contract-ingestion", {
      bucket: "forge-documents",
      key: "contracts/FA9999-25-C-0001.pdf",
      eventType: "created",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("Missing signature block");

    // Verify quality review Jira ticket created
    const jiraCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCalls.length).toBe(1);
    const params = jiraCalls[0]![1] as Record<string, unknown>;
    expect(params.issueType).toBe("Review");
    expect(params.summary).toContain("[REVIEW]");
    expect(params.description).toContain("MISSING_SIGNATURE");
  });
});
