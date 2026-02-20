import { describe, it, expect } from "vitest";
import { ArcadeClient } from "../arcade-client.js";

// ─── Tests ───────────────────────────────────────────────────────────

describe("ArcadeClient", () => {
  const client = new ArcadeClient({ mode: "mock" });

  // ─── Tool catalog ────────────────────────────────────────────────

  it("listTools returns all available tools", async () => {
    const tools = await client.listTools();

    expect(tools.length).toBeGreaterThanOrEqual(8);

    const names = tools.map((t) => t.name);
    expect(names).toContain("jira.createIssue");
    expect(names).toContain("jira.updateIssue");
    expect(names).toContain("jira.addComment");
    expect(names).toContain("microsoft.teams.sendMessage");
    expect(names).toContain("microsoft.outlook.sendEmail");
    expect(names).toContain("microsoft.outlook.readEmails");
    expect(names).toContain("s3.getObject");
    expect(names).toContain("s3.putObject");
  });

  // ─── Jira tools ──────────────────────────────────────────────────

  it("jira.createIssue returns an issue key", async () => {
    const result = await client.executeTool("jira.createIssue", {
      project: "FORGE",
      issueType: "Task",
      summary: "Review contract FA8726-24-C-0042",
      description: "Automated review task created by ingestion pipeline",
    });

    expect(result.success).toBe(true);
    expect(result.data.issueKey).toBeDefined();
    expect(result.data.issueKey).toMatch(/^FORGE-\d+$/);
    expect(result.data.project).toBe("FORGE");
    expect(result.data.status).toBe("Open");
    expect(result.data.self).toContain("jira.example.com");
  });

  it("jira.updateIssue updates fields", async () => {
    const result = await client.executeTool("jira.updateIssue", {
      issueKey: "FORGE-1234",
      fields: { status: "In Progress", assignee: "analyst@forge.gov" },
    });

    expect(result.success).toBe(true);
    expect(result.data.issueKey).toBe("FORGE-1234");
    expect(result.data.updated).toBe(true);
  });

  it("jira.addComment adds a comment to an issue", async () => {
    const result = await client.executeTool("jira.addComment", {
      issueKey: "FORGE-1234",
      comment: "Clause analysis complete. 3 high-risk items identified.",
    });

    expect(result.success).toBe(true);
    expect(result.data.issueKey).toBe("FORGE-1234");
    expect(result.data.commentId).toBeDefined();
    expect(result.data.body).toContain("Clause analysis complete");
  });

  // ─── Microsoft tools ─────────────────────────────────────────────

  it("microsoft.teams.sendMessage succeeds", async () => {
    const result = await client.executeTool("microsoft.teams.sendMessage", {
      channelId: "contracts-team",
      message: "New contract FA8726-24-C-0042 has been ingested and is ready for review.",
    });

    expect(result.success).toBe(true);
    expect(result.data.messageId).toBeDefined();
    expect(result.data.channelId).toBe("contracts-team");
    expect(result.data.sentAt).toBeDefined();
  });

  it("microsoft.outlook.sendEmail succeeds", async () => {
    const result = await client.executeTool("microsoft.outlook.sendEmail", {
      to: "officer@agency.gov",
      subject: "Action Required: Contract Review",
      body: "Please review the attached modification.",
    });

    expect(result.success).toBe(true);
    expect(result.data.messageId).toBeDefined();
    expect(result.data.to).toBe("officer@agency.gov");
    expect(result.data.subject).toBe("Action Required: Contract Review");
  });

  it("microsoft.outlook.readEmails returns email list", async () => {
    const result = await client.executeTool("microsoft.outlook.readEmails", {
      folder: "inbox",
      filter: "from:agency.gov",
    });

    expect(result.success).toBe(true);
    expect(result.data.emails).toBeDefined();
    expect((result.data.emails as any[]).length).toBeGreaterThan(0);
    expect(result.data.totalCount).toBeGreaterThan(0);
  });

  // ─── S3 tools ────────────────────────────────────────────────────

  it("s3.getObject returns object metadata", async () => {
    const result = await client.executeTool("s3.getObject", {
      bucket: "forge-documents",
      key: "contracts/FA8726-24-C-0042.docx",
    });

    expect(result.success).toBe(true);
    expect(result.data.bucket).toBe("forge-documents");
    expect(result.data.key).toBe("contracts/FA8726-24-C-0042.docx");
    expect(result.data.contentType).toBeDefined();
    expect(result.data.lastModified).toBeDefined();
  });

  it("s3.putObject returns etag", async () => {
    const result = await client.executeTool("s3.putObject", {
      bucket: "forge-documents",
      key: "exports/report-2024.pdf",
      content: "binary content here",
    });

    expect(result.success).toBe(true);
    expect(result.data.etag).toBeDefined();
    expect(result.data.versionId).toBeDefined();
  });

  // ─── Error handling ──────────────────────────────────────────────

  it("returns error for invalid tool names", async () => {
    const result = await client.executeTool("nonexistent.tool", {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Unknown tool");
    expect(result.error).toContain("nonexistent.tool");
  });

  it("returns error listing available tools for invalid names", async () => {
    const result = await client.executeTool("invalid", {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("jira.createIssue");
  });
});
