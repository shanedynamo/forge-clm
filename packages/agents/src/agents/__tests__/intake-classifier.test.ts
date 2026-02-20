import { describe, it, expect, vi } from "vitest";
import {
  IntakeClassifierAgent,
  calculatePriority,
  parseClassificationResponse,
  parseSoonestDeadlineDays,
  type EmailPayload,
  type ExtractedMetadata,
  type IntakePayload,
} from "../intake-classifier.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";
import type {
  AgentTask,
  AgentDependencies,
} from "../../framework/base-agent.js";

// ─── Mock LLM responses for each classification type ─────────────────

const LLM_RESPONSES: Record<string, string> = {
  nda: JSON.stringify({
    classification: "NDA",
    confidence: 0.97,
    summary: "Request to create NDA with Acme Corp for classified project",
    extractedMetadata: {
      parties: ["Acme Corp", "John Smith"],
      contractNumbers: [],
      dollarAmounts: [],
      deadlines: ["March 15"],
      urgencyIndicators: [],
    },
  }),
  mod: JSON.stringify({
    classification: "MOD",
    confidence: 0.95,
    summary: "SOW modification to add cybersecurity requirements on N00024-23-C-6789",
    extractedMetadata: {
      parties: [],
      contractNumbers: ["N00024-23-C-6789"],
      dollarAmounts: [1500000],
      deadlines: ["January 31, 2025"],
      urgencyIndicators: ["compliance deadline"],
    },
  }),
  option: JSON.stringify({
    classification: "OPTION_EXERCISE",
    confidence: 0.98,
    summary: "Option 2 exercise needed for W911NF-24-C-0042, expires in 5 days",
    extractedMetadata: {
      parties: [],
      contractNumbers: ["W911NF-24-C-0042"],
      dollarAmounts: [2300000],
      deadlines: ["in 5 days"],
      urgencyIndicators: ["expires in 5 days"],
    },
  }),
  funding: JSON.stringify({
    classification: "FUNDING_ACTION",
    confidence: 0.96,
    summary: "Request for $750K additional funding on CLIN 0003 of FA8726-24-C-0042",
    extractedMetadata: {
      parties: [],
      contractNumbers: ["FA8726-24-C-0042"],
      dollarAmounts: [750000],
      deadlines: ["December 2025"],
      urgencyIndicators: [],
    },
  }),
  inquiry: JSON.stringify({
    classification: "GENERAL_INQUIRY",
    confidence: 0.92,
    summary: "Inquiry about proposal status submitted two weeks ago",
    extractedMetadata: {
      parties: [],
      contractNumbers: [],
      dollarAmounts: [],
      deadlines: [],
      urgencyIndicators: [],
    },
  }),
  ambiguous: JSON.stringify({
    classification: "GENERAL_INQUIRY",
    confidence: 0.45,
    summary: "Unclear request that doesn't fit a specific category",
    extractedMetadata: {
      parties: [],
      contractNumbers: [],
      dollarAmounts: [],
      deadlines: [],
      urgencyIndicators: [],
    },
  }),
  contract_number_extraction: JSON.stringify({
    classification: "MOD",
    confidence: 0.90,
    summary: "Modification request referencing FA8726-24-C-0042",
    extractedMetadata: {
      parties: ["Raytheon"],
      contractNumbers: ["FA8726-24-C-0042"],
      dollarAmounts: [],
      deadlines: [],
      urgencyIndicators: [],
    },
  }),
  dollar_extraction: JSON.stringify({
    classification: "FUNDING_ACTION",
    confidence: 0.93,
    summary: "Funding increase of $2.5M requested",
    extractedMetadata: {
      parties: [],
      contractNumbers: ["W911NF-24-C-0099"],
      dollarAmounts: [2500000, 450000],
      deadlines: [],
      urgencyIndicators: [],
    },
  }),
};

// ─── Test helpers ────────────────────────────────────────────────────

function createMockDeps(llmResponse: string): AgentDependencies {
  return {
    llm: { complete: vi.fn().mockResolvedValue(llmResponse) },
    vectorSearch: { search: vi.fn().mockResolvedValue([]) },
    database: {
      query: vi.fn().mockResolvedValue([{ id: "req-001" }]),
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "c-1",
        contractNumber: "TEST-001",
        status: "ACTIVE",
        contractType: "FFP",
        ceilingValue: "1000000",
        fundedValue: "500000",
        awardingAgency: "DoD",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
      }),
    },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
    fsm: {
      transition: vi.fn().mockResolvedValue("ACTIVE"),
      getAvailableTransitions: vi.fn().mockResolvedValue([]),
    },
  };
}

function createEmailTask(overrides?: Partial<EmailPayload>): AgentTask {
  return {
    id: "task-001",
    agentName: "intake-classifier",
    triggerType: "EVENT",
    triggerPayload: {
      source: "email",
      subject: "Test Subject",
      body: "Test body content",
      sender: "user@agency.gov",
      date: "2024-06-15T10:00:00Z",
      ...overrides,
    } as unknown as Record<string, unknown>,
    priority: "MEDIUM",
    createdAt: new Date(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("IntakeClassifierAgent", () => {
  // ─── Classification tests ──────────────────────────────────────────

  it("classifies an NDA request email", async () => {
    const deps = createMockDeps(LLM_RESPONSES["nda"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "NDA Request - Acme Corp",
      body: "Please send an NDA to Acme Corp for the classified project",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("NDA");
    expect(result.data!.confidence).toBe(0.97);
    expect(result.data!.summary).toContain("NDA");
    expect(result.data!.jiraKey).toBeDefined();
  });

  it("classifies a modification request", async () => {
    const deps = createMockDeps(LLM_RESPONSES["mod"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "SOW Modification Needed",
      body: "We need to modify the SOW on contract N00024-23-C-6789 to add cybersecurity requirements",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("MOD");
    expect(result.data!.confidence).toBeGreaterThan(0.9);
  });

  it("classifies an option exercise notice", async () => {
    const deps = createMockDeps(LLM_RESPONSES["option"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Option Exercise - W911NF-24-C-0042",
      body: "Option 2 on W911NF-24-C-0042 expires in 5 days. Value is $2.3M.",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("OPTION_EXERCISE");
    expect(result.data!.priority).toBe("URGENT"); // $2.3M > $1M
  });

  it("classifies a funding action request", async () => {
    const deps = createMockDeps(LLM_RESPONSES["funding"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Funding Request - CLIN 0003",
      body: "Requesting additional funding of $750,000 on CLIN 0003 for contract FA8726-24-C-0042",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("FUNDING_ACTION");
    expect(result.data!.priority).toBe("HIGH"); // $750K > $500K
  });

  it("classifies a general inquiry", async () => {
    const deps = createMockDeps(LLM_RESPONSES["inquiry"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Question about contract status",
      body: "Can you let me know the current status of our proposal?",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("GENERAL_INQUIRY");
    // GENERAL_INQUIRY doesn't get written to contract_requests (not a valid DB type)
    expect(result.data!.requestId).toBeNull();
  });

  // ─── Priority calculation tests ────────────────────────────────────

  it("calculates URGENT priority for deadline within 7 days", () => {
    const metadata: ExtractedMetadata = {
      parties: [],
      contractNumbers: ["W911NF-24-C-0042"],
      dollarAmounts: [],
      deadlines: ["in 5 days"],
      urgencyIndicators: ["expires soon"],
    };

    expect(calculatePriority(metadata)).toBe("URGENT");
  });

  it("calculates HIGH priority for dollar amount > $500K", () => {
    const metadata: ExtractedMetadata = {
      parties: [],
      contractNumbers: [],
      dollarAmounts: [750000],
      deadlines: [],
      urgencyIndicators: [],
    };

    expect(calculatePriority(metadata)).toBe("HIGH");
  });

  // ─── Jira ticket creation test ─────────────────────────────────────

  it("creates Jira ticket with correct issue type and fields", async () => {
    const deps = createMockDeps(LLM_RESPONSES["mod"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const executeSpy = vi.spyOn(mcp, "executeTool");
    const agent = new IntakeClassifierAgent(deps, mcp, {
      jiraProject: "FORGE",
      defaultAssignee: "co@forge.gov",
    });

    const task = createEmailTask({
      subject: "SOW Modification Needed",
      body: "Modify contract N00024-23-C-6789",
    });

    await agent.execute(task);

    // Find the jira.createIssue call
    const createCall = executeSpy.mock.calls.find(
      ([name]) => name === "jira.createIssue",
    );
    expect(createCall).toBeDefined();
    const [, params] = createCall!;

    expect(params.project).toBe("FORGE");
    expect(params.issueType).toBe("Modification");
    expect(params.summary).toContain("[MOD]");
    expect(params.summary).toContain("SOW Modification Needed");
    expect((params.fields as any).priority.name).toBe("URGENT"); // $1.5M > $1M
    expect((params.fields as any).assignee).toBe("co@forge.gov");
    expect((params.fields as any).labels).toContain("intake-classified");
    expect((params.fields as any).labels).toContain("mod");
    expect((params.fields as any).customFields.contractNumbers).toContain("N00024-23-C-6789");

    // Also verify a comment was added with the original content
    const commentCall = executeSpy.mock.calls.find(
      ([name]) => name === "jira.addComment",
    );
    expect(commentCall).toBeDefined();
    expect(commentCall![1].comment).toContain("SOW Modification Needed");
  });

  // ─── Teams notification test ───────────────────────────────────────

  it("sends Teams notification with correct content", async () => {
    const deps = createMockDeps(LLM_RESPONSES["option"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const executeSpy = vi.spyOn(mcp, "executeTool");
    const agent = new IntakeClassifierAgent(deps, mcp, {
      teamsChannelId: "contracts-intake",
    });

    const task = createEmailTask({
      subject: "Option Exercise - W911NF-24-C-0042",
      body: "Option 2 expires in 5 days",
    });

    await agent.execute(task);

    const teamsCall = executeSpy.mock.calls.find(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCall).toBeDefined();

    const [, params] = teamsCall!;
    expect(params.channelId).toBe("contracts-intake");

    const message = params.message as string;
    expect(message).toContain("OPTION_EXERCISE");
    expect(message).toContain("URGENT");
    expect(message).toContain("W911NF-24-C-0042");
    expect(message).toContain("user@agency.gov"); // requester
  });

  // ─── Database record test ──────────────────────────────────────────

  it("creates contract_request database record", async () => {
    const deps = createMockDeps(LLM_RESPONSES["nda"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "NDA Request",
      body: "Please create an NDA",
      sender: "officer@agency.gov",
    });

    const result = await agent.execute(task);

    expect(result.data!.requestId).toBe("req-001");

    // Verify the DB query was called with correct params
    const dbQuery = deps.database.query as ReturnType<typeof vi.fn>;
    const insertCall = dbQuery.mock.calls.find(
      ([sql]: [string]) => sql.includes("contract_requests"),
    );
    expect(insertCall).toBeDefined();

    const [sql, params] = insertCall!;
    expect(sql).toContain("INSERT INTO contracts.contract_requests");
    expect(params[0]).toBe("NDA"); // request_type
    expect(params[1]).toBe("officer@agency.gov"); // requester_name
    expect(params[2]).toBe("officer@agency.gov"); // requester_email
    expect(params[4]).toBeDefined(); // jira_ticket_id
    expect(params[5]).toContain('"classification":"NDA"'); // details_json
  });

  // ─── Extraction tests ──────────────────────────────────────────────

  it("extracts contract numbers from email body", async () => {
    const deps = createMockDeps(LLM_RESPONSES["contract_number_extraction"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Modification for FA8726-24-C-0042",
      body: "Raytheon needs a modification to contract FA8726-24-C-0042",
    });

    const result = await agent.execute(task);

    const metadata = result.data!.extractedMetadata as Record<string, unknown>;
    expect(metadata.contractNumbers).toContain("FA8726-24-C-0042");
    expect(metadata.parties).toContain("Raytheon");
  });

  it("extracts dollar amounts from email body", async () => {
    const deps = createMockDeps(LLM_RESPONSES["dollar_extraction"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Funding increase needed",
      body: "We need $2.5M increase and $450K for travel on W911NF-24-C-0099",
    });

    const result = await agent.execute(task);

    const metadata = result.data!.extractedMetadata as Record<string, unknown>;
    expect(metadata.dollarAmounts).toContain(2500000);
    expect(metadata.dollarAmounts).toContain(450000);
  });

  // ─── Ambiguous request test ────────────────────────────────────────

  it("handles ambiguous requests by defaulting to GENERAL_INQUIRY", async () => {
    const deps = createMockDeps(LLM_RESPONSES["ambiguous"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task = createEmailTask({
      subject: "Hello",
      body: "I have a question about something. Not sure what I need.",
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("GENERAL_INQUIRY");
    expect(result.data!.confidence).toBeLessThan(0.5);
    // GENERAL_INQUIRY is not a valid DB request type → requestId is null
    expect(result.data!.requestId).toBeNull();
  });

  // ─── Full end-to-end flow test ─────────────────────────────────────

  it("executes the full intake flow end-to-end", async () => {
    const deps = createMockDeps(LLM_RESPONSES["option"]!);
    const mcp = new ArcadeClient({ mode: "mock" });
    const executeSpy = vi.spyOn(mcp, "executeTool");
    const agent = new IntakeClassifierAgent(deps, mcp);

    const task: AgentTask = {
      id: "task-e2e-001",
      agentName: "intake-classifier",
      triggerType: "EVENT",
      triggerPayload: {
        source: "email",
        subject: "URGENT: Option Exercise - W911NF-24-C-0042",
        body: "Option 2 on W911NF-24-C-0042 expires in 5 days. Please prepare the option exercise modification. The option value is $2.3M.",
        sender: "co@army.mil",
        date: "2024-06-15T08:00:00Z",
        attachments: ["option_notice.pdf"],
      },
      priority: "HIGH",
      createdAt: new Date(),
    };

    const result = await agent.execute(task);

    // 1. Classification correct
    expect(result.success).toBe(true);
    expect(result.data!.classification).toBe("OPTION_EXERCISE");
    expect(result.data!.confidence).toBe(0.98);

    // 2. Priority is URGENT ($2.3M > $1M AND deadline < 7 days)
    expect(result.data!.priority).toBe("URGENT");

    // 3. Jira ticket created
    expect(result.data!.jiraKey).toBeDefined();
    expect(result.data!.jiraSelf).toContain("jira.example.com");

    // 4. Teams notification sent
    expect(result.data!.teamsMessageId).toBeDefined();

    // 5. DB record created
    expect(result.data!.requestId).toBe("req-001");

    // 6. Audit log entries (RUNNING + SUCCESS)
    const auditLog = deps.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLog).toHaveBeenCalledTimes(2);
    expect(auditLog.mock.calls[0]![0].status).toBe("RUNNING");
    expect(auditLog.mock.calls[1]![0].status).toBe("SUCCESS");

    // 7. LLM was called with the prompt
    expect(deps.llm.complete).toHaveBeenCalledOnce();
    const prompt = (deps.llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(prompt).toContain("W911NF-24-C-0042");
    expect(prompt).toContain("co@army.mil");

    // 8. MCP tools: createIssue + addComment + sendMessage = 3 calls
    expect(executeSpy).toHaveBeenCalledTimes(3);
    const toolNames = executeSpy.mock.calls.map(([name]) => name);
    expect(toolNames).toContain("jira.createIssue");
    expect(toolNames).toContain("jira.addComment");
    expect(toolNames).toContain("microsoft.teams.sendMessage");

    // 9. DB insert was called
    const dbQuery = deps.database.query as ReturnType<typeof vi.fn>;
    expect(dbQuery).toHaveBeenCalledOnce();
    const [sql] = dbQuery.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO contracts.contract_requests");
  });
});

// ─── Unit tests for helper functions ─────────────────────────────────

describe("calculatePriority", () => {
  it("returns URGENT for dollar > $1M", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [1500000], deadlines: [], urgencyIndicators: [],
    })).toBe("URGENT");
  });

  it("returns HIGH for dollar > $500K", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [600000], deadlines: [], urgencyIndicators: [],
    })).toBe("HIGH");
  });

  it("returns URGENT for deadline within 7 days", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [], deadlines: ["within 3 days"], urgencyIndicators: [],
    })).toBe("URGENT");
  });

  it("returns HIGH for deadline within 30 days", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [], deadlines: ["in 20 days"], urgencyIndicators: [],
    })).toBe("HIGH");
  });

  it("returns MEDIUM for deadline within 60 days", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [], deadlines: ["in 45 days"], urgencyIndicators: [],
    })).toBe("MEDIUM");
  });

  it("returns MEDIUM for no indicators", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [], deadlines: [], urgencyIndicators: [],
    })).toBe("MEDIUM");
  });

  it("returns HIGH when urgency indicators present", () => {
    expect(calculatePriority({
      parties: [], contractNumbers: [],
      dollarAmounts: [], deadlines: [], urgencyIndicators: ["immediate action required"],
    })).toBe("HIGH");
  });
});

describe("parseClassificationResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseClassificationResponse(LLM_RESPONSES["nda"]!);
    expect(result.classification).toBe("NDA");
    expect(result.confidence).toBe(0.97);
    expect(result.extractedMetadata.parties).toContain("Acme Corp");
  });

  it("handles markdown code fences", () => {
    const wrapped = "```json\n" + LLM_RESPONSES["mod"]! + "\n```";
    const result = parseClassificationResponse(wrapped);
    expect(result.classification).toBe("MOD");
  });

  it("defaults unknown classifications to GENERAL_INQUIRY", () => {
    const raw = JSON.stringify({
      classification: "INVALID_TYPE",
      confidence: 0.5,
      summary: "test",
      extractedMetadata: { parties: [], contractNumbers: [], dollarAmounts: [], deadlines: [], urgencyIndicators: [] },
    });
    const result = parseClassificationResponse(raw);
    expect(result.classification).toBe("GENERAL_INQUIRY");
  });
});

describe("parseSoonestDeadlineDays", () => {
  it('parses "in N days" format', () => {
    expect(parseSoonestDeadlineDays(["in 30 days"])).toBe(30);
  });

  it('parses "within N days" format', () => {
    expect(parseSoonestDeadlineDays(["within 7 days"])).toBe(7);
  });

  it("returns soonest of multiple deadlines", () => {
    expect(parseSoonestDeadlineDays(["in 30 days", "in 5 days", "in 60 days"])).toBe(5);
  });

  it("returns null for empty array", () => {
    expect(parseSoonestDeadlineDays([])).toBeNull();
  });
});
