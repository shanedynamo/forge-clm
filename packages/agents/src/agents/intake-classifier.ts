/**
 * Intake Classifier Agent
 *
 * Classifies incoming emails and SharePoint form submissions,
 * extracts metadata, creates Jira tickets, sends Teams notifications,
 * and writes to the contract_requests table.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient, type ToolResult } from "../mcp/arcade-client.js";
import {
  buildClassificationPrompt,
  type ClassificationType,
  CLASSIFICATION_TYPES,
} from "./prompts/intake-classifier.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface EmailPayload {
  source: "email";
  subject: string;
  body: string;
  sender: string;
  date: string;
  attachments?: string[];
}

export interface SharePointFormPayload {
  source: "sharepoint_form";
  body: string;
  submitterName: string;
  submitterEmail: string;
  formFields?: Record<string, unknown>;
}

export type IntakePayload = EmailPayload | SharePointFormPayload;

export interface ClassificationResult {
  classification: ClassificationType;
  confidence: number;
  summary: string;
  extractedMetadata: ExtractedMetadata;
}

export interface ExtractedMetadata {
  parties: string[];
  contractNumbers: string[];
  dollarAmounts: number[];
  deadlines: string[];
  urgencyIndicators: string[];
}

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface IntakeClassifierConfig {
  defaultAssignee?: string;
  jiraProject?: string;
  teamsChannelId?: string;
}

// ─── DB request types (subset that can be persisted) ─────────────────

const DB_REQUEST_TYPES = new Set([
  "NDA", "MOU", "NEW_CONTRACT", "MOD", "OPTION_EXERCISE",
  "FUNDING_ACTION", "TASK_ASSIGNMENT", "SUB_MOD",
]);

// ─── Classification → Jira issue type mapping ───────────────────────

const ISSUE_TYPE_MAP: Record<ClassificationType, string> = {
  NDA: "NDA",
  MOU: "MOU",
  NEW_CONTRACT: "New Contract",
  MOD: "Modification",
  OPTION_EXERCISE: "Option Exercise",
  FUNDING_ACTION: "Funding Action",
  TASK_ASSIGNMENT: "Task Order",
  SUB_MOD: "Sub Modification",
  GENERAL_INQUIRY: "Inquiry",
  OTHER: "Task",
};

// ─── Priority calculation ────────────────────────────────────────────

const DAYS_MS = 24 * 60 * 60 * 1000;

export function calculatePriority(metadata: ExtractedMetadata): Priority {
  const maxDollar = Math.max(0, ...metadata.dollarAmounts);

  // Check urgency from dollar amounts
  if (maxDollar > 1_000_000) return "URGENT";
  if (maxDollar > 500_000) return "HIGH";

  // Check urgency from deadlines
  const soonestDays = parseSoonestDeadlineDays(metadata.deadlines);
  if (soonestDays !== null) {
    if (soonestDays <= 7) return "URGENT";
    if (soonestDays <= 30) return "HIGH";
    if (soonestDays <= 60) return "MEDIUM";
  }

  // Check explicit urgency indicators
  if (metadata.urgencyIndicators.length > 0) return "HIGH";

  return "MEDIUM";
}

/**
 * Parse deadline strings and return the soonest number of days from now.
 * Handles: "in N days", "within N days", "N days", and ISO/partial dates.
 */
export function parseSoonestDeadlineDays(deadlines: string[]): number | null {
  if (deadlines.length === 0) return null;

  let soonest: number | null = null;
  const now = Date.now();

  for (const d of deadlines) {
    const lower = d.toLowerCase().trim();

    // "in 30 days", "within 7 days", "30 days"
    const daysMatch = lower.match(/(?:in|within)?\s*(\d+)\s*days?/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]!, 10);
      if (soonest === null || days < soonest) soonest = days;
      continue;
    }

    // Try to parse as a date
    const parsed = Date.parse(d);
    if (!isNaN(parsed)) {
      const days = Math.max(0, Math.ceil((parsed - now) / DAYS_MS));
      if (soonest === null || days < soonest) soonest = days;
    }
  }

  return soonest;
}

// ─── LLM response parser ────────────────────────────────────────────

export function parseClassificationResponse(raw: string): ClassificationResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  // Validate classification type
  const classification = CLASSIFICATION_TYPES.includes(parsed.classification)
    ? (parsed.classification as ClassificationType)
    : "GENERAL_INQUIRY";

  return {
    classification,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    summary: parsed.summary ?? "",
    extractedMetadata: {
      parties: Array.isArray(parsed.extractedMetadata?.parties)
        ? parsed.extractedMetadata.parties
        : [],
      contractNumbers: Array.isArray(parsed.extractedMetadata?.contractNumbers)
        ? parsed.extractedMetadata.contractNumbers
        : [],
      dollarAmounts: Array.isArray(parsed.extractedMetadata?.dollarAmounts)
        ? parsed.extractedMetadata.dollarAmounts.map(Number).filter((n: number) => !isNaN(n))
        : [],
      deadlines: Array.isArray(parsed.extractedMetadata?.deadlines)
        ? parsed.extractedMetadata.deadlines
        : [],
      urgencyIndicators: Array.isArray(parsed.extractedMetadata?.urgencyIndicators)
        ? parsed.extractedMetadata.urgencyIndicators
        : [],
    },
  };
}

// ─── Agent ───────────────────────────────────────────────────────────

export class IntakeClassifierAgent extends BaseAgent {
  readonly name = "intake-classifier";
  readonly type = "intake";
  readonly description =
    "Classifies incoming emails and form submissions, extracts metadata, creates Jira tickets, and sends notifications";

  private readonly mcp: ArcadeClient;
  private readonly config: IntakeClassifierConfig;

  constructor(
    deps: AgentDependencies,
    mcp?: ArcadeClient,
    config?: IntakeClassifierConfig,
  ) {
    super(deps);
    this.mcp = mcp ?? new ArcadeClient();
    this.config = {
      defaultAssignee: config?.defaultAssignee ?? "contracts-team@forge.gov",
      jiraProject: config?.jiraProject ?? "FORGE",
      teamsChannelId: config?.teamsChannelId ?? "contracts-intake",
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload = task.triggerPayload as unknown as IntakePayload;

    // 1. Log start
    await this.createAuditEntry(task.id, "RUNNING", {
      input: { source: payload.source },
    });

    // 2. Build prompt and classify via LLM
    const prompt = buildClassificationPrompt({
      source: payload.source,
      subject: payload.source === "email" ? payload.subject : undefined,
      body: payload.body,
      sender: payload.source === "email" ? payload.sender : payload.submitterEmail,
      date: payload.source === "email" ? payload.date : undefined,
      attachments: payload.source === "email" ? payload.attachments : undefined,
    });

    const llmResponse = await this.callLLM(prompt, {
      temperature: 0.1,
      maxTokens: 1024,
    });

    const classification = parseClassificationResponse(llmResponse);

    // 3. Calculate priority
    const priority = calculatePriority(classification.extractedMetadata);

    // 4. Create Jira ticket
    const requesterName = payload.source === "email"
      ? payload.sender
      : payload.submitterName;
    const requesterEmail = payload.source === "email"
      ? payload.sender
      : payload.submitterEmail;

    const jiraResult = await this.createJiraTicket(
      classification,
      priority,
      requesterName,
      payload,
    );

    const issueKey = jiraResult.data.issueKey as string;

    // 5. Add original content as Jira comment
    const originalContent = payload.source === "email"
      ? `From: ${payload.sender}\nDate: ${payload.date}\nSubject: ${payload.subject}\n\n${payload.body}`
      : `Submitted by: ${payload.submitterName} (${payload.submitterEmail})\n\n${payload.body}`;

    await this.mcp.executeTool("jira.addComment", {
      issueKey,
      comment: originalContent,
    });

    // 6. Send Teams notification
    const teamsResult = await this.sendTeamsNotification(
      classification,
      priority,
      issueKey,
      requesterName,
    );

    // 7. Write to contract_requests table
    let requestId: string | null = null;
    const dbRequestType = DB_REQUEST_TYPES.has(classification.classification)
      ? classification.classification
      : null;

    if (dbRequestType) {
      const rows = await this.queryDatabase(
        `INSERT INTO contracts.contract_requests
         (request_type, requester_name, requester_email, priority, jira_ticket_id, details_json, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
         RETURNING id`,
        [
          dbRequestType,
          requesterName,
          requesterEmail,
          priority,
          issueKey,
          JSON.stringify({
            classification: classification.classification,
            confidence: classification.confidence,
            summary: classification.summary,
            metadata: classification.extractedMetadata,
            source: payload.source,
          }),
        ],
      );
      requestId = (rows[0] as { id: string })?.id ?? null;
    }

    // 8. Log completion
    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { source: payload.source },
      output: {
        classification: classification.classification,
        confidence: classification.confidence,
        priority,
        jiraKey: issueKey,
        requestId,
      },
    });

    return {
      success: true,
      data: {
        classification: classification.classification,
        confidence: classification.confidence,
        summary: classification.summary,
        priority,
        jiraKey: issueKey,
        jiraSelf: jiraResult.data.self,
        teamsMessageId: teamsResult.data.messageId,
        requestId,
        extractedMetadata: classification.extractedMetadata as unknown as Record<string, unknown>,
      },
    };
  }

  // ─── Jira ticket creation ──────────────────────────────────────────

  private async createJiraTicket(
    classification: ClassificationResult,
    priority: Priority,
    requester: string,
    payload: IntakePayload,
  ): Promise<ToolResult> {
    const subject = payload.source === "email"
      ? payload.subject
      : classification.summary;

    return this.mcp.executeTool("jira.createIssue", {
      project: this.config.jiraProject,
      issueType: ISSUE_TYPE_MAP[classification.classification],
      summary: `[${classification.classification}] ${subject}`,
      description: classification.summary,
      fields: {
        priority: { name: priority },
        assignee: this.config.defaultAssignee,
        labels: ["intake-classified", classification.classification.toLowerCase()],
        customFields: {
          requester,
          confidence: classification.confidence,
          contractNumbers: classification.extractedMetadata.contractNumbers,
          dollarAmounts: classification.extractedMetadata.dollarAmounts,
          parties: classification.extractedMetadata.parties,
          deadlines: classification.extractedMetadata.deadlines,
        },
      },
    });
  }

  // ─── Teams notification ────────────────────────────────────────────

  private async sendTeamsNotification(
    classification: ClassificationResult,
    priority: Priority,
    issueKey: string,
    requester: string,
  ): Promise<ToolResult> {
    const priorityEmoji =
      priority === "URGENT" ? "🔴" :
      priority === "HIGH" ? "🟠" :
      priority === "MEDIUM" ? "🟡" : "🟢";

    const message = [
      `${priorityEmoji} **New Intake: ${classification.classification}** (${priority})`,
      `**Summary:** ${classification.summary}`,
      `**Requester:** ${requester}`,
      `**Confidence:** ${(classification.confidence * 100).toFixed(0)}%`,
      `**Jira:** ${issueKey}`,
      classification.extractedMetadata.contractNumbers.length > 0
        ? `**Contracts:** ${classification.extractedMetadata.contractNumbers.join(", ")}`
        : null,
      classification.extractedMetadata.dollarAmounts.length > 0
        ? `**Amounts:** ${classification.extractedMetadata.dollarAmounts.map((a) => `$${a.toLocaleString()}`).join(", ")}`
        : null,
    ].filter(Boolean).join("\n");

    return this.mcp.executeTool("microsoft.teams.sendMessage", {
      channelId: this.config.teamsChannelId,
      message,
    });
  }
}
