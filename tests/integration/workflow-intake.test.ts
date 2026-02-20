/**
 * Integration test: Intake Classification Workflow
 *
 * email → LLM classify → Jira ticket → Teams notification → DB request → audit log
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import {
  IntakeClassifierAgent,
  ArcadeClient,
} from "@forge/agents";
import type { EmailPayload } from "@forge/agents";
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
} from "./helpers.js";

// ─── Fixtures ───────────────────────────────────────────────────────

let client: ReturnType<typeof postgres>;

const MOCK_LLM_RESPONSE = JSON.stringify({
  classification: "MOD",
  confidence: 0.92,
  summary: "Request to modify contract FA8726-24-C-0042 scope of work",
  extractedMetadata: {
    parties: ["Lockheed Martin", "USAF"],
    contractNumbers: ["FA8726-24-C-0042"],
    dollarAmounts: [750000],
    deadlines: ["2026-03-15"],
    urgencyIndicators: ["action required"],
  },
});

const EMAIL_PAYLOAD: EmailPayload = {
  source: "email",
  subject: "Contract FA8726-24-C-0042 - Modification Request",
  body: "We need to modify the scope of work for contract FA8726-24-C-0042. The estimated additional cost is $750,000. Please process by 2026-03-15. Action required.",
  sender: "co@agency.gov",
  date: "2026-02-19T10:00:00Z",
  attachments: ["mod_request.pdf"],
};

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

describe("Intake Classification Workflow", () => {
  it("classifies email, creates Jira ticket, sends Teams notification, writes DB request, and logs audit", async () => {
    // 1. Build dependencies with real DB + audit, mock LLM
    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const llm = createMockLlm([MOCK_LLM_RESPONSE]);
    const vectorSearch = createMockVectorSearch();
    const fsm = createMockFsm();

    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new IntakeClassifierAgent(
      { llm, vectorSearch, database: dbProvider, audit: auditProvider, fsm },
      mcp,
      { jiraProject: "FORGE", teamsChannelId: "contracts-intake" },
    );

    // 2. Execute the agent
    const task = createTask("intake-classifier", EMAIL_PAYLOAD as unknown as Record<string, unknown>);
    const result = await agent.execute(task);

    // ── Verification 1: Agent succeeded ──────────────────────────
    expect(result.success).toBe(true);
    expect(result.data?.classification).toBe("MOD");
    expect(result.data?.confidence).toBe(0.92);
    expect(result.data?.priority).toBe("HIGH"); // $750k > $500k → HIGH

    // ── Verification 2: LLM was called with correct prompt ──────
    expect(llm.complete).toHaveBeenCalledOnce();
    const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(prompt).toContain("FA8726-24-C-0042");
    expect(prompt).toContain("co@agency.gov");

    // ── Verification 3: Jira ticket created ─────────────────────
    const jiraCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCalls.length).toBe(1);
    const jiraParams = jiraCalls[0]![1] as Record<string, unknown>;
    expect(jiraParams.project).toBe("FORGE");
    expect(jiraParams.issueType).toBe("Modification");
    expect(jiraParams.summary).toContain("[MOD]");

    // ── Verification 4: Jira comment added with original content ─
    const commentCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.addComment",
    );
    expect(commentCalls.length).toBe(1);
    const commentParams = commentCalls[0]![1] as Record<string, unknown>;
    expect(commentParams.comment).toContain("co@agency.gov");
    expect(commentParams.comment).toContain("FA8726-24-C-0042");

    // ── Verification 5: Teams notification sent ─────────────────
    const teamsCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCalls.length).toBe(1);
    const teamsParams = teamsCalls[0]![1] as Record<string, unknown>;
    expect(teamsParams.channelId).toBe("contracts-intake");
    expect(teamsParams.message).toContain("MOD");
    expect(teamsParams.message).toContain("HIGH");

    // ── Verification 6: DB request created ──────────────────────
    const dbRows = await client.unsafe(
      "SELECT * FROM contracts.contract_requests WHERE jira_ticket_id IS NOT NULL",
    );
    expect(dbRows.length).toBe(1);
    const req = dbRows[0] as any;
    expect(req.request_type).toBe("MOD");
    expect(req.requester_email).toBe("co@agency.gov");
    expect(req.priority).toBe("HIGH");
    expect(req.status).toBe("OPEN");

    const details = typeof req.details_json === "string" ? JSON.parse(req.details_json) : req.details_json;
    expect(details.classification).toBe("MOD");
    expect(details.confidence).toBe(0.92);
    expect(details.metadata.contractNumbers).toContain("FA8726-24-C-0042");

    // ── Verification 7: Audit log entries created ───────────────
    const auditRows = await client.unsafe(
      `SELECT * FROM audit.agent_execution_log
       WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(auditRows.length).toBe(2); // RUNNING + SUCCESS
    expect((auditRows[0] as any).status).toBe("RUNNING");
    expect((auditRows[1] as any).status).toBe("SUCCESS");
    const raw = (auditRows[1] as any).output_summary;
    const outputSummary = typeof raw === "string" ? JSON.parse(raw) : raw;
    expect(outputSummary.classification).toBe("MOD");
    expect(outputSummary.jiraKey).toBeDefined();
  });

  it("classifies GENERAL_INQUIRY and does NOT write to contract_requests", async () => {
    const generalResponse = JSON.stringify({
      classification: "GENERAL_INQUIRY",
      confidence: 0.85,
      summary: "General question about contract processes",
      extractedMetadata: {
        parties: [],
        contractNumbers: [],
        dollarAmounts: [],
        deadlines: [],
        urgencyIndicators: [],
      },
    });

    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const llm = createMockLlm([generalResponse]);
    const mcp = new ArcadeClient({ mode: "mock" });

    const agent = new IntakeClassifierAgent(
      {
        llm,
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm: createMockFsm(),
      },
      mcp,
    );

    const task = createTask("intake-classifier", {
      source: "email",
      subject: "How do I submit a new contract request?",
      body: "Could you explain the process for submitting new contract requests?",
      sender: "newuser@company.com",
      date: "2026-02-19T12:00:00Z",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data?.classification).toBe("GENERAL_INQUIRY");

    // GENERAL_INQUIRY should NOT create a contract_requests row
    const dbRows = await client.unsafe(
      "SELECT * FROM contracts.contract_requests",
    );
    expect(dbRows.length).toBe(0);

    // But audit log should still exist
    const auditRows = await client.unsafe(
      `SELECT * FROM audit.agent_execution_log WHERE task_id = $1`,
      [task.id],
    );
    expect(auditRows.length).toBe(2);
  });

  it("calculates URGENT priority for high-dollar amounts", async () => {
    const urgentResponse = JSON.stringify({
      classification: "NEW_CONTRACT",
      confidence: 0.95,
      summary: "New $2M contract award request",
      extractedMetadata: {
        parties: ["Boeing"],
        contractNumbers: [],
        dollarAmounts: [2000000],
        deadlines: [],
        urgencyIndicators: [],
      },
    });

    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const llm = createMockLlm([urgentResponse]);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new IntakeClassifierAgent(
      {
        llm,
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm: createMockFsm(),
      },
      mcp,
    );

    const task = createTask("intake-classifier", {
      source: "email",
      subject: "New Contract Award - Boeing - $2M",
      body: "Please initiate a new FFP contract with Boeing for $2,000,000.",
      sender: "procurement@agency.gov",
      date: "2026-02-19T14:00:00Z",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data?.priority).toBe("URGENT"); // $2M > $1M → URGENT

    // Verify DB request has URGENT priority
    const dbRows = await client.unsafe(
      "SELECT priority FROM contracts.contract_requests",
    );
    expect(dbRows.length).toBe(1);
    expect((dbRows[0] as any).priority).toBe("URGENT");

    // Verify Teams notification reflects urgency
    const teamsCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCalls.length).toBe(1);
    const msg = (teamsCalls[0]![1] as Record<string, unknown>).message as string;
    expect(msg).toContain("URGENT");
  });
});
