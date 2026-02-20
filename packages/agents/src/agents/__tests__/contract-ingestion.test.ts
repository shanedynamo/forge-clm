import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContractIngestionAgent,
  type IngestionResponse,
  type NlpPipelineClient,
  type S3EventPayload,
} from "../contract-ingestion.js";
import { ClauseDiffer, type Clause } from "../helpers/clause-differ.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";
import type { AgentTask, AgentDependencies } from "../../framework/base-agent.js";

// ─── Mock NLP responses ──────────────────────────────────────────────

function createNlpResponse(overrides?: Partial<IngestionResponse>): IngestionResponse {
  return {
    result: {
      contract_id: "nlp-contract-001",
      s3_key: "contracts/FA8726-24-C-0042.docx",
      document_type: "docx",
      text_length: 45000,
      chunk_count: 25,
      entity_count: 42,
      chunks_stored: 25,
      annotations_stored: 42,
      metadata: {
        contract_number: "FA8726-24-C-0042",
        ceiling_value: "12500000.00",
        funded_value: "5000000.00",
        pop_start: "2024-01-01",
        pop_end: "2025-12-31",
        naics_code: "541512",
        psc_code: "D306",
        security_level: "CUI",
        cage_code: "1ABC2",
        uei_number: "K12345678901",
        contracting_officer_name: "Jane Smith",
        far_clauses: ["52.212-4", "52.219-8", "52.222-26"],
        dfars_clauses: ["252.204-7012", "252.227-7014"],
      },
      duration_ms: 3200,
      ...overrides?.result,
    },
    quality: {
      issues: [],
      needs_human_review: false,
      review_reasons: [],
      entity_count: 42,
      chunk_count: 25,
      ...overrides?.quality,
    },
  };
}

function createQualityIssueResponse(): IngestionResponse {
  return createNlpResponse({
    quality: {
      issues: [
        {
          severity: "ERROR",
          code: "MISSING_POP",
          message: "Period of performance could not be extracted",
          details: {},
        },
        {
          severity: "WARNING",
          code: "LOW_ENTITY_CONFIDENCE",
          message: "Several entities extracted with low confidence",
          details: { count: 5 },
        },
      ],
      needs_human_review: true,
      review_reasons: [
        "Missing period of performance",
        "Low entity extraction confidence",
      ],
      entity_count: 42,
      chunk_count: 25,
    },
  });
}

// ─── Mock NLP client ─────────────────────────────────────────────────

class MockNlpClient implements NlpPipelineClient {
  ingest = vi.fn<[string, "docx" | "pdf"], Promise<IngestionResponse>>();

  constructor(response?: IngestionResponse) {
    this.ingest.mockResolvedValue(response ?? createNlpResponse());
  }
}

// ─── Test helpers ────────────────────────────────────────────────────

/** Track the SQL queries made via queryDatabase to verify DB operations. */
interface QueryCall {
  sql: string;
  params: unknown[];
}

function createMockDeps(options?: {
  existingContract?: boolean;
  existingClauses?: Clause[];
}): AgentDependencies & { queryCalls: QueryCall[] } {
  const queryCalls: QueryCall[] = [];

  const queryFn = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    queryCalls.push({ sql, params });

    // SELECT for existing contract check
    if (sql.includes("SELECT id FROM contracts.contracts WHERE contract_number")) {
      return options?.existingContract
        ? [{ id: "existing-contract-id" }]
        : [];
    }

    // SELECT existing clauses
    if (sql.includes("SELECT clause_number")) {
      return (options?.existingClauses ?? []).map((c) => ({
        clause_number: c.clauseNumber,
        clause_title: c.clauseTitle,
        clause_type: c.clauseType,
      }));
    }

    // INSERT contract returning id
    if (sql.includes("INSERT INTO contracts.contracts")) {
      return [{ id: "new-contract-id" }];
    }

    // INSERT modification returning id
    if (sql.includes("INSERT INTO contracts.modifications")) {
      return [{ id: "new-mod-id" }];
    }

    // INSERT clause (ON CONFLICT DO NOTHING)
    if (sql.includes("INSERT INTO contracts.contract_clauses")) {
      return [];
    }

    // INSERT agent_tasks (downstream trigger)
    if (sql.includes("INSERT INTO agents.agent_tasks")) {
      return [];
    }

    return [];
  });

  return {
    queryCalls,
    llm: { complete: vi.fn().mockResolvedValue("ok") },
    vectorSearch: { search: vi.fn().mockResolvedValue([]) },
    database: {
      query: queryFn,
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "c-1",
        contractNumber: "FA8726-24-C-0042",
        status: "ACTIVE",
        contractType: "FFP",
        ceilingValue: "12500000.00",
        fundedValue: "5000000.00",
        awardingAgency: "USAF",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
      }),
    },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
    fsm: {
      transition: vi.fn().mockResolvedValue("AWARDED"),
      getAvailableTransitions: vi.fn().mockResolvedValue([]),
    },
  };
}

function createS3Task(overrides?: Partial<S3EventPayload>): AgentTask {
  return {
    id: "task-ingest-001",
    agentName: "contract-ingestion",
    triggerType: "EVENT",
    triggerPayload: {
      bucket: "forge-documents",
      key: "contracts/FA8726-24-C-0042.docx",
      eventType: "created",
      ...overrides,
    } as unknown as Record<string, unknown>,
    priority: "MEDIUM",
    createdAt: new Date(),
  };
}

function buildAgent(
  deps: AgentDependencies,
  nlpClient?: MockNlpClient,
  mcp?: ArcadeClient,
) {
  return new ContractIngestionAgent(deps, {
    mcp: mcp ?? new ArcadeClient({ mode: "mock" }),
    nlp: nlpClient ?? new MockNlpClient(),
    config: { maxRetries: 1, retryDelayMs: 10 },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("ContractIngestionAgent", () => {
  // ─── New contract tests ────────────────────────────────────────────

  it("creates a contract record for a new contract document", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    const result = await agent.execute(createS3Task());

    expect(result.success).toBe(true);
    expect(result.data!.contractId).toBe("new-contract-id");
    expect(result.data!.isModification).toBe(false);

    // Verify contract INSERT was made
    const insertCall = deps.queryCalls.find((c) =>
      c.sql.includes("INSERT INTO contracts.contracts"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall!.params[0]).toBe("FA8726-24-C-0042"); // contract_number
  });

  it("populates all extracted metadata fields in the contract record", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    await agent.execute(createS3Task());

    const insertCall = deps.queryCalls.find((c) =>
      c.sql.includes("INSERT INTO contracts.contracts"),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall!.params;

    // contract_number, contract_type, awarding_agency, co_name, co_email,
    // pop_start, pop_end, ceiling_value, funded_value,
    // naics_code, psc_code, security_level, cage_code, uei_number, s3_key
    expect(params[0]).toBe("FA8726-24-C-0042");
    expect(params[5]).toBe("2024-01-01"); // pop_start
    expect(params[6]).toBe("2025-12-31"); // pop_end
    expect(params[7]).toBe("12500000.00"); // ceiling_value
    expect(params[8]).toBe("5000000.00"); // funded_value
    expect(params[9]).toBe("541512"); // naics_code
    expect(params[10]).toBe("D306"); // psc_code
    expect(params[11]).toBe("CUI"); // security_level
    expect(params[12]).toBe("1ABC2"); // cage_code
    expect(params[13]).toBe("K12345678901"); // uei_number
    expect(params[14]).toBe("contracts/FA8726-24-C-0042.docx"); // s3_document_key
  });

  it("stores chunks with embeddings via NLP pipeline", async () => {
    const deps = createMockDeps();
    const nlpClient = new MockNlpClient();
    const agent = buildAgent(deps, nlpClient);

    const result = await agent.execute(createS3Task());

    // NLP pipeline stores chunks directly; verify the result reports them
    expect(result.data!.chunkCount).toBe(25);
    expect(result.data!.chunksStored).toBe(25);
    expect(result.data!.entityCount).toBe(42);
    expect(result.data!.annotationsStored).toBe(42);

    // Verify NLP client was called
    expect(nlpClient.ingest).toHaveBeenCalledWith(
      "contracts/FA8726-24-C-0042.docx",
      "docx",
    );
  });

  it("creates clause records from extracted FAR and DFARS clauses", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    const result = await agent.execute(createS3Task());

    // 3 FAR + 2 DFARS = 5 clause inserts
    expect(result.data!.clauseCount).toBe(5);

    const clauseInserts = deps.queryCalls.filter((c) =>
      c.sql.includes("INSERT INTO contracts.contract_clauses"),
    );
    expect(clauseInserts.length).toBe(5);

    // Check first FAR clause
    expect(clauseInserts[0]!.params[1]).toBe("52.212-4");
    expect(clauseInserts[0]!.params[3]).toBe("FAR");

    // Check first DFARS clause
    expect(clauseInserts[3]!.params[1]).toBe("252.204-7012");
    expect(clauseInserts[3]!.params[3]).toBe("DFARS");
  });

  // ─── Modification tests ────────────────────────────────────────────

  it("links modification to parent contract", async () => {
    const deps = createMockDeps({ existingContract: true });
    const agent = buildAgent(deps);

    const task = createS3Task({
      key: "contracts/FA8726-24-C-0042/mod_01.docx",
      eventType: "modified",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.isModification).toBe(true);
    expect(result.data!.modificationId).toBe("new-mod-id");
    expect(result.data!.contractId).toBe("existing-contract-id");

    // Verify modification INSERT links to parent
    const modInsert = deps.queryCalls.find((c) =>
      c.sql.includes("INSERT INTO contracts.modifications"),
    );
    expect(modInsert).toBeDefined();
    expect(modInsert!.params[0]).toBe("existing-contract-id");
  });

  it("triggers mod FSM on modification processing", async () => {
    const deps = createMockDeps({ existingContract: true });
    const agent = buildAgent(deps);

    const task = createS3Task({
      key: "contracts/FA8726-24-C-0042/mod_01.docx",
    });

    await agent.execute(task);

    expect(deps.fsm.transition).toHaveBeenCalledWith(
      "MODIFICATION",
      "new-mod-id",
      "MOD_IDENTIFIED",
      "system",
      "system",
    );
  });

  // ─── Clause differ tests ───────────────────────────────────────────

  it("detects added clauses", () => {
    const differ = new ClauseDiffer();

    const oldClauses: Clause[] = [
      { clauseNumber: "52.212-4", clauseTitle: "Contract Terms", clauseType: "FAR" },
    ];
    const newClauses: Clause[] = [
      { clauseNumber: "52.212-4", clauseTitle: "Contract Terms", clauseType: "FAR" },
      { clauseNumber: "52.219-8", clauseTitle: "Small Business", clauseType: "FAR" },
    ];

    const diff = differ.compare(oldClauses, newClauses);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.clauseNumber).toBe("52.219-8");
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects removed clauses", () => {
    const differ = new ClauseDiffer();

    const oldClauses: Clause[] = [
      { clauseNumber: "52.212-4", clauseTitle: "Contract Terms", clauseType: "FAR" },
      { clauseNumber: "52.219-8", clauseTitle: "Small Business", clauseType: "FAR" },
    ];
    const newClauses: Clause[] = [
      { clauseNumber: "52.212-4", clauseTitle: "Contract Terms", clauseType: "FAR" },
    ];

    const diff = differ.compare(oldClauses, newClauses);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]!.clauseNumber).toBe("52.219-8");
    expect(diff.added).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects modified clause text", () => {
    const differ = new ClauseDiffer();

    const oldClauses: Clause[] = [
      {
        clauseNumber: "52.212-4",
        clauseTitle: "Contract Terms",
        clauseType: "FAR",
        text: "Original clause text version A",
      },
    ];
    const newClauses: Clause[] = [
      {
        clauseNumber: "52.212-4",
        clauseTitle: "Contract Terms",
        clauseType: "FAR",
        text: "Updated clause text version B with new requirements",
      },
    ];

    const diff = differ.compare(oldClauses, newClauses);

    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]!.clauseNumber).toBe("52.212-4");
    expect(diff.modified[0]!.oldText).toContain("version A");
    expect(diff.modified[0]!.newText).toContain("version B");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  // ─── Quality issues ────────────────────────────────────────────────

  it("creates Jira ticket when quality issues trigger review", async () => {
    const deps = createMockDeps();
    const nlpClient = new MockNlpClient(createQualityIssueResponse());
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, nlpClient, mcp);

    const result = await agent.execute(createS3Task());

    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("Missing period of performance");

    // Find the Jira createIssue call for quality review
    const jiraCall = mcpSpy.mock.calls.find(
      ([name, params]) =>
        name === "jira.createIssue" &&
        (params.summary as string).includes("[REVIEW]"),
    );
    expect(jiraCall).toBeDefined();
    const [, params] = jiraCall!;
    expect(params.summary).toContain("FA8726-24-C-0042");
    expect(params.description).toContain("MISSING_POP");
    expect((params.fields as any).priority.name).toBe("HIGH");
    expect((params.fields as any).labels).toContain("quality-issue");
  });

  // ─── Downstream triggers ───────────────────────────────────────────

  it("fires downstream agent triggers", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    const result = await agent.execute(createS3Task());

    // Should trigger: clause-analysis (always) + compliance-monitor (POP present)
    const downstreamAgents = result.data!.downstreamAgents as string[];
    expect(downstreamAgents).toContain("clause-analysis");
    expect(downstreamAgents).toContain("compliance-monitor");

    // Verify agent_tasks inserts
    const taskInserts = deps.queryCalls.filter((c) =>
      c.sql.includes("INSERT INTO agents.agent_tasks"),
    );
    expect(taskInserts.length).toBe(2);

    // Verify clause-analysis trigger payload
    const clauseAnalysisTrigger = taskInserts.find((c) => c.params[0] === "clause-analysis");
    expect(clauseAnalysisTrigger).toBeDefined();
    const clausePayload = JSON.parse(clauseAnalysisTrigger!.params[1] as string);
    expect(clausePayload.contractId).toBe("new-contract-id");
    expect(clausePayload.s3Key).toBe("contracts/FA8726-24-C-0042.docx");
  });

  // ─── Unsupported file types ────────────────────────────────────────

  it("handles unsupported file types", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    const task = createS3Task({ key: "contracts/file.xlsx" });
    const result = await agent.execute(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported file type: xlsx");
    expect(result.error).toContain("docx, pdf");
  });

  // ─── NLP service unavailability ────────────────────────────────────

  it("retries when NLP service is unavailable", async () => {
    const deps = createMockDeps();
    const nlpClient = new MockNlpClient();
    nlpClient.ingest
      .mockRejectedValueOnce(new Error("NLP service unavailable"))
      .mockResolvedValueOnce(createNlpResponse());

    const agent = buildAgent(deps, nlpClient);

    const result = await agent.execute(createS3Task());

    expect(result.success).toBe(true);
    expect(nlpClient.ingest).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries when NLP is down", async () => {
    const deps = createMockDeps();
    const nlpClient = new MockNlpClient();
    nlpClient.ingest.mockRejectedValue(new Error("Connection refused"));

    const agent = buildAgent(deps, nlpClient);

    const result = await agent.execute(createS3Task());

    expect(result.success).toBe(false);
    expect(result.error).toContain("NLP pipeline failed after 2 attempts");
    expect(result.error).toContain("Connection refused");
    // maxRetries=1 → 2 total attempts
    expect(nlpClient.ingest).toHaveBeenCalledTimes(2);
  });

  // ─── Audit logging ─────────────────────────────────────────────────

  it("captures full execution details in audit log", async () => {
    const deps = createMockDeps();
    const agent = buildAgent(deps);

    await agent.execute(createS3Task());

    const auditLog = deps.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLog).toHaveBeenCalledTimes(2);

    // First call: RUNNING
    const runningEntry = auditLog.mock.calls[0]![0];
    expect(runningEntry.status).toBe("RUNNING");
    expect(runningEntry.taskId).toBe("task-ingest-001");
    expect(runningEntry.inputSummary.bucket).toBe("forge-documents");
    expect(runningEntry.inputSummary.key).toBe("contracts/FA8726-24-C-0042.docx");

    // Second call: SUCCESS
    const successEntry = auditLog.mock.calls[1]![0];
    expect(successEntry.status).toBe("SUCCESS");
    expect(successEntry.outputSummary.contractId).toBe("new-contract-id");
    expect(successEntry.outputSummary.chunkCount).toBe(25);
    expect(successEntry.outputSummary.entityCount).toBe(42);
    expect(successEntry.outputSummary.durationMs).toBe(3200);
    expect(successEntry.outputSummary.downstreamAgents).toContain("clause-analysis");
  });

  // ─── End-to-end ────────────────────────────────────────────────────

  it("end-to-end: S3 upload -> process -> verify database state", async () => {
    const deps = createMockDeps();
    const nlpClient = new MockNlpClient();
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, nlpClient, mcp);

    const task: AgentTask = {
      id: "task-e2e-ingest",
      agentName: "contract-ingestion",
      triggerType: "EVENT",
      triggerPayload: {
        bucket: "forge-documents",
        key: "contracts/FA8726-24-C-0042.docx",
        eventType: "created",
      },
      priority: "HIGH",
      createdAt: new Date(),
    };

    const result = await agent.execute(task);

    // 1. Success
    expect(result.success).toBe(true);

    // 2. S3 download happened
    const s3Call = mcpSpy.mock.calls.find(([name]) => name === "s3.getObject");
    expect(s3Call).toBeDefined();
    expect(s3Call![1].bucket).toBe("forge-documents");
    expect(s3Call![1].key).toBe("contracts/FA8726-24-C-0042.docx");

    // 3. NLP pipeline called
    expect(nlpClient.ingest).toHaveBeenCalledWith(
      "contracts/FA8726-24-C-0042.docx",
      "docx",
    );

    // 4. Contract record created with metadata
    const contractInsert = deps.queryCalls.find((c) =>
      c.sql.includes("INSERT INTO contracts.contracts"),
    );
    expect(contractInsert).toBeDefined();
    expect(contractInsert!.params[0]).toBe("FA8726-24-C-0042");

    // 5. FSM transition to AWARDED
    expect(deps.fsm.transition).toHaveBeenCalledWith(
      "PRIME_CONTRACT",
      "new-contract-id",
      "AWARDED",
      "system",
      "system",
    );

    // 6. Clauses stored (5 total: 3 FAR + 2 DFARS)
    expect(result.data!.clauseCount).toBe(5);

    // 7. Downstream agents triggered
    const downstreamInserts = deps.queryCalls.filter((c) =>
      c.sql.includes("INSERT INTO agents.agent_tasks"),
    );
    expect(downstreamInserts.length).toBe(2);

    // 8. Audit logged (RUNNING + SUCCESS)
    const auditLog = deps.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLog).toHaveBeenCalledTimes(2);

    // 9. Result data completeness
    expect(result.data!.contractId).toBe("new-contract-id");
    expect(result.data!.chunkCount).toBe(25);
    expect(result.data!.entityCount).toBe(42);
    expect(result.data!.clauseCount).toBe(5);
    expect(result.data!.needsReview).toBe(false);
    expect(result.data!.metadata).toBeDefined();
  });
});
