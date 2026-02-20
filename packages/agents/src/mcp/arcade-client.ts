/**
 * Arcade MCP client — executes tools via MCP runtime.
 *
 * For local dev: mock tool executor that simulates Jira, MS Graph, S3 calls.
 * For production: connects to Arcade's MCP runtime.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ArcadeClientConfig {
  mode: "mock" | "production";
  arcadeUrl?: string;
  apiKey?: string;
}

// ─── Mock tool implementations ───────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

function createMockTools(): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();

  // ── Jira tools ─────────────────────────────────────────────────────

  tools.set("jira.createIssue", async (params) => {
    const { project, issueType, summary, description, fields } = params;
    const issueKey = `${project ?? "FORGE"}-${Math.floor(Math.random() * 9000) + 1000}`;
    return {
      success: true,
      data: {
        issueKey,
        issueId: `${Date.now()}`,
        self: `https://jira.example.com/rest/api/2/issue/${issueKey}`,
        project: project ?? "FORGE",
        issueType: issueType ?? "Task",
        summary: summary ?? "",
        status: "Open",
      },
    };
  });

  tools.set("jira.updateIssue", async (params) => {
    const { issueKey, fields } = params;
    return {
      success: true,
      data: {
        issueKey,
        updated: true,
        fields: fields ?? {},
      },
    };
  });

  tools.set("jira.addComment", async (params) => {
    const { issueKey, comment } = params;
    return {
      success: true,
      data: {
        issueKey,
        commentId: `comment-${Date.now()}`,
        body: comment ?? "",
        created: new Date().toISOString(),
      },
    };
  });

  // ── Microsoft tools ────────────────────────────────────────────────

  tools.set("microsoft.teams.sendMessage", async (params) => {
    const { channelId, message } = params;
    return {
      success: true,
      data: {
        messageId: `msg-${Date.now()}`,
        channelId: channelId ?? "general",
        content: message ?? "",
        sentAt: new Date().toISOString(),
      },
    };
  });

  tools.set("microsoft.outlook.sendEmail", async (params) => {
    const { to, subject, body } = params;
    return {
      success: true,
      data: {
        messageId: `email-${Date.now()}`,
        to: to ?? "",
        subject: subject ?? "",
        bodyPreview: typeof body === "string" ? body.slice(0, 100) : "",
        sentAt: new Date().toISOString(),
      },
    };
  });

  tools.set("microsoft.outlook.readEmails", async (params) => {
    const { folder, filter } = params;
    return {
      success: true,
      data: {
        folder: folder ?? "inbox",
        filter: filter ?? "",
        emails: [
          {
            id: "email-001",
            from: "co@agency.gov",
            subject: "Contract FA8726-24-C-0042 - Action Required",
            receivedAt: new Date().toISOString(),
            bodyPreview: "Please review the attached modification request...",
          },
          {
            id: "email-002",
            from: "legal@agency.gov",
            subject: "NDA Review Complete",
            receivedAt: new Date().toISOString(),
            bodyPreview: "The NDA has been reviewed and approved...",
          },
        ],
        totalCount: 2,
      },
    };
  });

  // ── S3 tools ───────────────────────────────────────────────────────

  tools.set("s3.getObject", async (params) => {
    const { bucket, key } = params;
    return {
      success: true,
      data: {
        bucket: bucket ?? "forge-documents",
        key: key ?? "",
        contentType: "application/pdf",
        contentLength: 245760,
        lastModified: new Date().toISOString(),
        body: "[mock binary content]",
      },
    };
  });

  tools.set("s3.putObject", async (params) => {
    const { bucket, key, content } = params;
    return {
      success: true,
      data: {
        bucket: bucket ?? "forge-documents",
        key: key ?? "",
        etag: `"${Date.now().toString(16)}"`,
        versionId: `v-${Date.now()}`,
      },
    };
  });

  return tools;
}

// ─── Tool catalog ────────────────────────────────────────────────────

const TOOL_CATALOG: Tool[] = [
  {
    name: "jira.createIssue",
    description: "Create a new Jira issue",
    parameters: { project: "string", issueType: "string", summary: "string", description: "string", fields: "object" },
  },
  {
    name: "jira.updateIssue",
    description: "Update an existing Jira issue",
    parameters: { issueKey: "string", fields: "object" },
  },
  {
    name: "jira.addComment",
    description: "Add a comment to a Jira issue",
    parameters: { issueKey: "string", comment: "string" },
  },
  {
    name: "microsoft.teams.sendMessage",
    description: "Send a message to a Microsoft Teams channel",
    parameters: { channelId: "string", message: "string" },
  },
  {
    name: "microsoft.outlook.sendEmail",
    description: "Send an email via Microsoft Outlook",
    parameters: { to: "string", subject: "string", body: "string" },
  },
  {
    name: "microsoft.outlook.readEmails",
    description: "Read emails from Microsoft Outlook",
    parameters: { folder: "string", filter: "string" },
  },
  {
    name: "s3.getObject",
    description: "Get an object from S3",
    parameters: { bucket: "string", key: "string" },
  },
  {
    name: "s3.putObject",
    description: "Put an object in S3",
    parameters: { bucket: "string", key: "string", content: "string" },
  },
];

// ─── ArcadeClient ────────────────────────────────────────────────────

export class ArcadeClient {
  private readonly config: ArcadeClientConfig;
  private readonly mockTools: Map<string, ToolHandler>;

  constructor(config?: Partial<ArcadeClientConfig>) {
    this.config = {
      mode: config?.mode ?? (process.env["ARCADE_MODE"] === "production" ? "production" : "mock"),
      arcadeUrl: config?.arcadeUrl ?? process.env["ARCADE_URL"],
      apiKey: config?.apiKey ?? process.env["ARCADE_API_KEY"],
    };
    this.mockTools = createMockTools();
  }

  /**
   * Execute a tool by name with parameters.
   */
  async executeTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (this.config.mode === "production") {
      return this.executeProductionTool(toolName, params);
    }

    return this.executeMockTool(toolName, params);
  }

  /**
   * List all available tools.
   */
  async listTools(): Promise<Tool[]> {
    return TOOL_CATALOG;
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private async executeMockTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const handler = this.mockTools.get(toolName);
    if (!handler) {
      return {
        success: false,
        data: {},
        error: `Unknown tool: "${toolName}". Available tools: ${[...this.mockTools.keys()].join(", ")}`,
      };
    }
    return handler(params);
  }

  private async executeProductionTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    // TODO: Implement Arcade MCP runtime connection
    throw new Error(
      "Production Arcade MCP client is not yet implemented. Set ARCADE_MODE=mock for local development.",
    );
  }
}
