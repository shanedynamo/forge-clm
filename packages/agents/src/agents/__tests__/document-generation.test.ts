import { describe, it, expect, vi } from "vitest";
import {
  DocumentGenerationAgent,
  type DocumentType,
  type DocumentGenerationPayload,
  TEMPLATE_MAP,
} from "../document-generation.js";
import { TemplateEngine } from "../helpers/template-engine.js";
import type {
  AgentTask,
  AgentDependencies,
} from "../../framework/base-agent.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";

// ─── Constants ───────────────────────────────────────────────────────

const CONTRACT_ID = "contract-001";
const NDA_ID = "nda-001";
const MOU_ID = "mou-001";
const OPTION_ID = "option-001";
const MOD_ID = "mod-001";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTask(payload: DocumentGenerationPayload): AgentTask {
  return {
    id: "task-docgen-001",
    agentName: "document-generation",
    triggerType: "EVENT",
    priority: "MEDIUM",
    createdAt: new Date(),
    triggerPayload: payload as unknown as Record<string, unknown>,
  };
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

function buildMocks(opts?: {
  ndaRow?: Record<string, unknown>;
  mouRow?: Record<string, unknown>;
  mouPartyRows?: unknown[];
  optionRow?: Record<string, unknown>;
  clinRows?: unknown[];
  modRow?: Record<string, unknown>;
  engineOverride?: TemplateEngine;
}) {
  const queryCalls: QueryCall[] = [];

  const mockDeps: AgentDependencies = {
    llm: { complete: vi.fn(async () => "") },
    vectorSearch: { search: vi.fn(async () => []) },
    database: {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        queryCalls.push({ sql, params: _params });

        // NDA query
        if (sql.includes("contracts.ndas") && sql.includes("SELECT")) {
          return opts?.ndaRow ? [opts.ndaRow] : [];
        }
        // MOU query
        if (sql.includes("contracts.mous") && sql.includes("SELECT")) {
          return opts?.mouRow ? [opts.mouRow] : [];
        }
        // MOU parties
        if (sql.includes("mou_parties") && sql.includes("SELECT")) {
          return opts?.mouPartyRows ?? [];
        }
        // Contract options
        if (
          sql.includes("contract_options") &&
          sql.includes("SELECT")
        ) {
          return opts?.optionRow ? [opts.optionRow] : [];
        }
        // CLINs
        if (sql.includes("contracts.clins") && sql.includes("SELECT")) {
          return opts?.clinRows ?? [];
        }
        // Modifications
        if (
          sql.includes("contracts.modifications") &&
          sql.includes("SELECT")
        ) {
          return opts?.modRow ? [opts.modRow] : [];
        }
        // CO lookup
        if (sql.includes("contracting_officer_name")) {
          return [{ contracting_officer_name: "Jane Doe, CO" }];
        }
        return [];
      }),
      getContractContext: vi.fn(async () => ({
        contractId: CONTRACT_ID,
        contractNumber: "W56HZV-24-C-0001",
        status: "ACTIVE",
        contractType: "CPFF",
        ceilingValue: "5000000.00",
        fundedValue: "3000000.00",
        awardingAgency: "US Army",
        popStart: "2024-01-01",
        popEnd: "2026-12-31",
      })),
    },
    audit: { log: vi.fn(async () => {}) },
    fsm: {
      transition: vi.fn(async () => "OK"),
      getAvailableTransitions: vi.fn(async () => []),
    },
  };

  const mockMcp = new ArcadeClient({ mockMode: true });
  vi.spyOn(mockMcp, "executeTool").mockImplementation(async () => ({
    success: true,
    data: { url: "https://s3.example.com/doc.docx" },
  }));

  return {
    mockDeps,
    mockMcp,
    queryCalls,
    engine: opts?.engineOverride ?? new TemplateEngine(),
  };
}

// ─── NDA mock data ───────────────────────────────────────────────────

const MUTUAL_NDA_ROW = {
  nda_type: "MUTUAL",
  effective_date: "2024-08-01",
  expiration_date: "2025-08-01",
  scope_description: "Joint engineering program evaluation",
  party_a_name: "Dynamo Technologies, Inc.",
  party_a_address: "1945 Old Gallows Rd, Vienna, VA 22182",
  party_b_name: "Acme Defense Corp",
  party_b_address: "456 Oak Ave, Arlington, VA 22201",
};

const UNILATERAL_NDA_ROW = {
  ...MUTUAL_NDA_ROW,
  nda_type: "UNILATERAL",
  scope_description: "Proprietary technical data review",
};

// ─── Tests ───────────────────────────────────────────────────────────

describe("DocumentGenerationAgent", () => {
  // ── NDA ────────────────────────────────────────────────────────────

  it("generates NDA with all required fields populated", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      ndaRow: MUTUAL_NDA_ROW,
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(true);
    const content = result.data!.content as string;

    // All required fields populated
    expect(content).toContain("2024-08-01"); // effectiveDate
    expect(content).toContain("2025-08-01"); // expirationDate
    expect(content).toContain("Dynamo Technologies, Inc."); // party1Name
    expect(content).toContain("Acme Defense Corp"); // party2Name
    expect(content).toContain("Joint engineering program evaluation"); // scope
    expect(content).toContain("MUTUAL NON-DISCLOSURE");

    // Government contract section included (contractId provided)
    expect(content).toContain("W56HZV-24-C-0001");
    expect(content).toContain("US Army");
  });

  it("selects correct template for mutual vs unilateral NDA", async () => {
    // Mutual
    const { mockDeps: d1, mockMcp: m1, engine: e1 } = buildMocks({
      ndaRow: MUTUAL_NDA_ROW,
    });
    const agent1 = new DocumentGenerationAgent(d1, { mcp: m1, engine: e1 });
    const r1 = await agent1.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
      }),
    );
    expect(r1.data!.templateUsed).toBe("nda_mutual.docx");
    expect((r1.data!.content as string)).toContain("MUTUAL NON-DISCLOSURE");
    expect((r1.data!.content as string)).toContain("Party 1:");

    // Unilateral
    const { mockDeps: d2, mockMcp: m2, engine: e2 } = buildMocks({
      ndaRow: UNILATERAL_NDA_ROW,
    });
    const agent2 = new DocumentGenerationAgent(d2, { mcp: m2, engine: e2 });
    const r2 = await agent2.execute(
      makeTask({
        documentType: "NDA_UNILATERAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
      }),
    );
    expect(r2.data!.templateUsed).toBe("nda_unilateral.docx");
    expect((r2.data!.content as string)).toContain("UNILATERAL NON-DISCLOSURE");
    expect((r2.data!.content as string)).toContain("Disclosing Party:");
    expect((r2.data!.content as string)).toContain("Proprietary technical data review");
  });

  // ── MOU ────────────────────────────────────────────────────────────

  it("generates MOU with all parties included", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      mouRow: {
        effective_date: "2024-09-01",
        expiration_date: "2025-09-01",
        purpose: "Joint cybersecurity research collaboration",
        obligations_summary:
          "Each party contributes subject matter experts and shared lab access.",
      },
      mouPartyRows: [
        { name: "Dynamo Technologies", role: "Lead", address: "Vienna, VA" },
        { name: "Acme Corp", role: "Partner", address: "Arlington, VA" },
        { name: "Beta Inc", role: "Subcontractor", address: "Reston, VA" },
      ],
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({ documentType: "MOU", mouId: MOU_ID }),
    );

    expect(result.success).toBe(true);
    const content = result.data!.content as string;

    expect(content).toContain("MEMORANDUM OF UNDERSTANDING");
    expect(content).toContain("Dynamo Technologies");
    expect(content).toContain("Acme Corp");
    expect(content).toContain("Beta Inc");
    expect(content).toContain("Lead");
    expect(content).toContain("Partner");
    expect(content).toContain("Subcontractor");
    expect(content).toContain("Joint cybersecurity research collaboration");
  });

  // ── Option Exercise ────────────────────────────────────────────────

  it("generates option exercise letter with correct option details", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      optionRow: {
        option_number: 2,
        option_start: "2025-01-01",
        option_end: "2025-12-31",
        option_value: "1500000.00",
        exercise_deadline: "2024-09-30",
        status: "NOT_EXERCISED",
      },
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "OPTION_EXERCISE_LETTER",
        optionId: OPTION_ID,
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(true);
    const content = result.data!.content as string;

    expect(content).toContain("OPTION EXERCISE LETTER");
    expect(content).toContain("W56HZV-24-C-0001");
    expect(content).toContain("2"); // optionNumber
    expect(content).toContain("2025-01-01"); // optionStart
    expect(content).toContain("2025-12-31"); // optionEnd
    expect(content).toContain("1500000.00"); // optionValue
    expect(content).toContain("2024-09-30"); // exerciseBy
    expect(content).toContain("Jane Doe, CO"); // contractingOfficer
    expect(content).toContain("request to exercise"); // exerciseRequested conditional
  });

  // ── Funding Request ────────────────────────────────────────────────

  it("generates funding request with current funding status", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      clinRows: [
        {
          clin_number: "0001",
          description: "Engineering Support",
          funded_amount: "2000000.00",
          total_value: "3000000.00",
        },
        {
          clin_number: "0002",
          description: "Program Management",
          funded_amount: "1000000.00",
          total_value: "2000000.00",
        },
      ],
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "FUNDING_ACTION_REQUEST",
        contractId: CONTRACT_ID,
        additionalData: {
          requestedAmount: "500000.00",
          justification: "Additional staffing for Phase 2 deliverables",
          requesterName: "Sarah Johnson",
        },
      }),
    );

    expect(result.success).toBe(true);
    const content = result.data!.content as string;

    expect(content).toContain("FUNDING ACTION REQUEST");
    expect(content).toContain("5000000.00"); // ceilingValue
    expect(content).toContain("3000000.00"); // fundedValue
    expect(content).toContain("2000000.00"); // ceilingRemaining
    expect(content).toContain("500000.00"); // requestedAmount
    expect(content).toContain("Additional staffing for Phase 2");
    expect(content).toContain("CLIN 0001"); // CLIN detail
    expect(content).toContain("Engineering Support");
    expect(content).toContain("CLIN 0002");
    expect(content).toContain("Program Management");
  });

  // ── Mod Cover Letter ───────────────────────────────────────────────

  it("generates mod cover letter with change summary", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      modRow: {
        mod_number: "P00003",
        mod_type: "BILATERAL",
        effective_date: "2024-08-15",
        description: "Add CLIN 0003 for cybersecurity support services",
        ceiling_delta: "250000.00",
        funding_delta: "150000.00",
        sf30_reference: "SF30-2024-003",
      },
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "MOD_COVER_LETTER",
        modId: MOD_ID,
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(true);
    const content = result.data!.content as string;

    expect(content).toContain("MODIFICATION COVER LETTER");
    expect(content).toContain("P00003");
    expect(content).toContain("BILATERAL");
    expect(content).toContain("2024-08-15");
    expect(content).toContain("cybersecurity support services");
    expect(content).toContain("250000.00"); // ceilingDelta
    expect(content).toContain("150000.00"); // fundingDelta
    expect(content).toContain("SF30-2024-003"); // sf30 conditional
  });

  // ── Template Engine ────────────────────────────────────────────────

  it("template engine replaces {{placeholder}} tokens", () => {
    const engine = new TemplateEngine();
    const template = {
      name: "test",
      content: "Hello {{name}}, your order #{{orderId}} is ready.",
    };

    const result = engine.populate(template, {
      name: "Alice",
      orderId: "12345",
    });

    expect(result).toBe("Hello Alice, your order #12345 is ready.");
  });

  it("template engine handles conditional sections", () => {
    const engine = new TemplateEngine();
    const template = {
      name: "test",
      content:
        "Base.{{#if premium}} Premium features enabled.{{/if}} End.",
    };

    const withPremium = engine.populate(template, { premium: true });
    expect(withPremium).toContain("Premium features enabled.");

    const withoutPremium = engine.populate(template, { premium: false });
    expect(withoutPremium).not.toContain("Premium features enabled.");
    expect(withoutPremium).toContain("Base.");
    expect(withoutPremium).toContain("End.");
  });

  // ── S3, Jira, Teams ───────────────────────────────────────────────

  it("stores generated document in S3", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      ndaRow: MUTUAL_NDA_ROW,
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data!.s3Key).toMatch(
      /^documents\/nda_mutual\/contract-001\/\d+\.docx$/,
    );

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "s3.putObject",
      expect.objectContaining({
        bucket: "forge-documents",
        key: expect.stringContaining("nda_mutual"),
        contentType: expect.stringContaining("wordprocessingml"),
      }),
    );
  });

  it("updates Jira ticket with document link", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      ndaRow: MUTUAL_NDA_ROW,
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
        jiraKey: "FORGE-123",
      }),
    );

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "jira.addComment",
      expect.objectContaining({
        issueKey: "FORGE-123",
        comment: expect.stringContaining("nda_mutual.docx"),
      }),
    );
  });

  it("sends notification to requester via Teams", async () => {
    const { mockDeps, mockMcp, engine } = buildMocks({
      ndaRow: MUTUAL_NDA_ROW,
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
        requesterEmail: "sarah@dynamo.com",
      }),
    );

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "microsoft.teams.sendMessage",
      expect.objectContaining({
        channelId: "contracts-documents",
        message: expect.stringContaining("sarah@dynamo.com"),
      }),
    );
  });

  // ── Error handling ─────────────────────────────────────────────────

  it("handles missing template gracefully", async () => {
    // Use an engine with no templates loaded
    const emptyEngine = new TemplateEngine({});
    const { mockDeps, mockMcp } = buildMocks({
      engineOverride: emptyEngine,
    });
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine: emptyEngine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        ndaId: NDA_ID,
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Template not found");
  });

  it("handles missing required data fields gracefully", async () => {
    // NDA without ndaId → no NDA data loaded → required fields missing
    const { mockDeps, mockMcp, engine } = buildMocks({});
    const agent = new DocumentGenerationAgent(mockDeps, {
      mcp: mockMcp,
      engine,
    });

    const result = await agent.execute(
      makeTask({
        documentType: "NDA_MUTUAL",
        // ndaId deliberately omitted
        contractId: CONTRACT_ID,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required fields");
    expect(result.needsReview).toBe(true);
    expect(result.error).toContain("effectiveDate");
  });
});
