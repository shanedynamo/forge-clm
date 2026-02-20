/**
 * Integration test: Document Generation Workflow
 *
 * request → load NDA data → populate template → store S3
 * → Jira comment → Teams notification → audit
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import {
  DocumentGenerationAgent,
  ArcadeClient,
  TemplateEngine,
} from "@forge/agents";
import type { DocumentGenerationPayload } from "@forge/agents";
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

// ─── Helpers ────────────────────────────────────────────────────────

async function seedNda(pgClient: ReturnType<typeof postgres>): Promise<{ ndaId: string; partyAId: string; partyBId: string }> {
  // Create two parties
  const partyARows = await pgClient.unsafe(
    `INSERT INTO contracts.parties (name, cage_code, address, active)
     VALUES ('Acme Defense Corp', '1ACME', '123 Defense Blvd, Arlington VA', true)
     RETURNING id`,
  );
  const partyAId = (partyARows[0] as any).id;

  const partyBRows = await pgClient.unsafe(
    `INSERT INTO contracts.parties (name, cage_code, address, active)
     VALUES ('US Air Force - AFLCMC', '2USAF', '1864 4th St, WPAFB OH', true)
     RETURNING id`,
  );
  const partyBId = (partyBRows[0] as any).id;

  // Create NDA
  const ndaRows = await pgClient.unsafe(
    `INSERT INTO contracts.ndas
     (party_a_id, party_b_id, effective_date, expiration_date, nda_type, scope_description, status)
     VALUES ($1, $2, '2026-03-01', '2027-03-01', 'MUTUAL', 'Protection of technical data for F-35 program', 'DRAFT')
     RETURNING id`,
    [partyAId, partyBId],
  );
  const ndaId = (ndaRows[0] as any).id;

  return { ndaId, partyAId, partyBId };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Document Generation Workflow", () => {
  it("generates mutual NDA document: loads data, populates template, stores S3, notifies", async () => {
    const { ndaId } = await seedNda(client);

    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const engine = new TemplateEngine();

    const agent = new DocumentGenerationAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm: createMockFsm(),
      },
      { mcp, engine },
    );

    const payload: DocumentGenerationPayload = {
      documentType: "NDA_MUTUAL",
      ndaId,
      jiraKey: "FORGE-1234",
      requesterEmail: "contracts@acme.com",
    };

    const task = createTask("document-generation", payload as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    // ── Verification 1: Agent succeeded ─────────────────────────
    expect(result.success).toBe(true);
    expect(result.data?.documentType).toBe("NDA_MUTUAL");
    expect(result.data?.templateUsed).toBe("nda_mutual.docx");

    // ── Verification 2: Template populated with NDA data ────────
    const content = result.data?.content as string;
    expect(content).toBeDefined();
    expect(content).toContain("Acme Defense Corp");
    expect(content).toContain("US Air Force");
    expect(content).toContain("2026-03-01");
    expect(content).toContain("F-35 program");

    // ── Verification 3: S3 upload ───────────────────────────────
    const s3Calls = mcpSpy.mock.calls.filter(
      ([name]) => name === "s3.putObject",
    );
    expect(s3Calls.length).toBe(1);
    const s3Params = s3Calls[0]![1] as Record<string, unknown>;
    expect(s3Params.bucket).toBe("forge-documents");
    expect(s3Params.key).toContain("nda_mutual");
    expect(s3Params.content).toBe(content);

    // ── Verification 4: Jira comment added ──────────────────────
    const commentCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.addComment",
    );
    expect(commentCalls.length).toBe(1);
    const commentParams = commentCalls[0]![1] as Record<string, unknown>;
    expect(commentParams.issueKey).toBe("FORGE-1234");
    expect(commentParams.comment).toContain("nda_mutual.docx");

    // ── Verification 5: Teams notification ──────────────────────
    const teamsCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCalls.length).toBe(1);
    const teamsParams = teamsCalls[0]![1] as Record<string, unknown>;
    expect(teamsParams.message).toContain("Document Generated");
    expect(teamsParams.message).toContain("NDA MUTUAL");
    expect(teamsParams.message).toContain("contracts@acme.com");

    // ── Verification 6: Audit log ───────────────────────────────
    const auditRows = await client.unsafe(
      `SELECT * FROM audit.agent_execution_log WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(auditRows.length).toBe(2);
    expect((auditRows[0] as any).status).toBe("RUNNING");
    expect((auditRows[1] as any).status).toBe("SUCCESS");
    const rawOut = (auditRows[1] as any).output_summary;
    const outputSummary = typeof rawOut === "string" ? JSON.parse(rawOut) : rawOut;
    expect(outputSummary.s3Key).toContain("nda_mutual");
  });

  it("generates option exercise letter with contract context", async () => {
    // Seed contract + option
    const contractId = await seedContract(client, {
      contract_number: "OPT-TEST-001",
      status: "ACTIVE",
      ceiling_value: "3000000.00",
      funded_value: "2000000.00",
      contracting_officer_name: "Col. Adams",
    });

    await client.unsafe(
      `INSERT INTO contracts.contract_options
       (contract_id, option_number, option_start, option_end, option_value, exercise_deadline, status)
       VALUES ($1, 2, '2026-07-01', '2027-06-30', '800000.00', '2026-04-01', 'NOT_EXERCISED')
       RETURNING id`,
      [contractId],
    );
    const optionRows = await client.unsafe(
      `SELECT id FROM contracts.contract_options WHERE contract_id = $1`,
      [contractId],
    );
    const optionId = (optionRows[0] as any).id;

    const dbProvider = createDbProvider(client);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const engine = new TemplateEngine();

    const agent = new DocumentGenerationAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: createAuditProvider(client),
        fsm: createMockFsm(),
      },
      { mcp, engine },
    );

    const payload: DocumentGenerationPayload = {
      documentType: "OPTION_EXERCISE_LETTER",
      contractId,
      optionId,
      requesterEmail: "pm@acme.com",
    };

    const task = createTask("document-generation", payload as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data?.templateUsed).toBe("option_exercise_letter.docx");

    const content = result.data?.content as string;
    expect(content).toContain("OPT-TEST-001");
    expect(content).toContain("Col. Adams");

    // S3 upload
    const s3Calls = mcpSpy.mock.calls.filter(([name]) => name === "s3.putObject");
    expect(s3Calls.length).toBe(1);
    expect((s3Calls[0]![1] as any).key).toContain("option_exercise_letter");
  });

  it("fails with missing required fields and sets needsReview", async () => {
    // Create NDA with no party data → template fields will be missing
    const emptyNdaRows = await client.unsafe(
      `INSERT INTO contracts.parties (name, active)
       VALUES ('Party A', true), ('Party B', true)
       RETURNING id`,
    );
    const pAId = (emptyNdaRows[0] as any).id;
    const pBId = (emptyNdaRows[1] as any).id;

    // NDA without scope_description → "scope" field will be empty
    const ndaRows = await client.unsafe(
      `INSERT INTO contracts.ndas
       (party_a_id, party_b_id, effective_date, expiration_date, nda_type, status)
       VALUES ($1, $2, '2026-03-01', '2027-03-01', 'UNILATERAL', 'DRAFT')
       RETURNING id`,
      [pAId, pBId],
    );
    const ndaId = (ndaRows[0] as any).id;

    const dbProvider = createDbProvider(client);
    const engine = new TemplateEngine();

    const agent = new DocumentGenerationAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: createAuditProvider(client),
        fsm: createMockFsm(),
      },
      { mcp: new ArcadeClient({ mode: "mock" }), engine },
    );

    const payload: DocumentGenerationPayload = {
      documentType: "NDA_UNILATERAL",
      ndaId,
    };

    const task = createTask("document-generation", payload as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    // scope_description is NULL → "scope" required field is missing
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required fields");
    expect(result.error).toContain("scope");
    expect(result.needsReview).toBe(true);
  });
});
