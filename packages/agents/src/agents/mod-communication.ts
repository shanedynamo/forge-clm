/**
 * Mod Communication Agent
 *
 * Tracks modification communication lifecycles, parses incoming
 * CO correspondence, drafts responses, pre-populates SF-30 fields,
 * detects overdue responses, and logs all exchanges.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ModCommunicationPayload {
  /** When processing a specific inbound email */
  emailContent?: InboundEmail;
  /** When running scheduled overdue check */
  scheduledCheck?: boolean;
  /** When drafting a response for a known mod */
  draftResponse?: { modId: string; contractId: string };
}

export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string; // ISO timestamp
  s3Key?: string;
}

export type CommType =
  | "INITIAL_NOTIFICATION"
  | "COUNTER_PROPOSAL"
  | "REQUEST_FOR_INFORMATION"
  | "ACCEPTANCE"
  | "REJECTION";

export interface ParsedModReference {
  contractNumber: string | null;
  modNumber: string | null;
  contractId: string | null;
  modId: string | null;
}

export interface CommClassification {
  type: CommType;
  confidence: number;
}

export interface SF30Fields {
  contractNumber: string;
  modNumber: string;
  effectiveDate: string;
  contractingOfficer: string;
  contractor: string;
  description: string;
  ceilingDelta: string;
  fundingDelta: string;
}

export interface OverdueAlert {
  modId: string;
  contractNumber: string;
  modNumber: string;
  status: string;
  responseDueDate: string;
  daysRemaining: number;
  severity: "WARNING" | "URGENT" | "OVERDUE";
}

export interface ModCommunicationConfig {
  responseDueDays?: number;
  jiraProject?: string;
  teamsChannelId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_RESPONSE_DUE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Regex patterns ──────────────────────────────────────────────────

// Matches DoD contract numbers: W56HZV-24-C-0001, FA8732-23-D-0042, etc.
const CONTRACT_NUMBER_RE =
  /\b([A-Z][A-Z0-9]{4,5}-\d{2}-[A-Z]-\d{4})\b/i;

// Matches mod references: Mod P00003, Modification A00001, P00012, A00005
const MOD_NUMBER_RE =
  /\b(?:mod(?:ification)?[\s#:]*)?([PA]\d{5})\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse contract and mod references from email subject + body.
 */
export function parseModReferences(
  subject: string,
  body: string,
): { contractNumber: string | null; modNumber: string | null } {
  const text = `${subject}\n${body}`;
  const contractMatch = text.match(CONTRACT_NUMBER_RE);
  const modMatch = text.match(MOD_NUMBER_RE);

  return {
    contractNumber: contractMatch ? contractMatch[1]!.toUpperCase() : null,
    modNumber: modMatch ? modMatch[1]!.toUpperCase() : null,
  };
}

/**
 * Classify communication type from LLM JSON response.
 */
export function parseClassificationResponse(raw: string): CommClassification {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const parsed = JSON.parse(cleaned);

  const validTypes: CommType[] = [
    "INITIAL_NOTIFICATION",
    "COUNTER_PROPOSAL",
    "REQUEST_FOR_INFORMATION",
    "ACCEPTANCE",
    "REJECTION",
  ];

  return {
    type: validTypes.includes(parsed.type)
      ? (parsed.type as CommType)
      : "INITIAL_NOTIFICATION",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

/**
 * Calculate response due date: receipt + N calendar days.
 */
export function calculateResponseDueDate(
  receivedAt: string | Date,
  dueDays: number,
): Date {
  const received = new Date(receivedAt);
  return new Date(received.getTime() + dueDays * MS_PER_DAY);
}

/**
 * Map comm type → FSM transition target state.
 * Returns null if no transition is warranted.
 */
const COMM_TYPE_TO_FSM_STATE: Partial<Record<CommType, string>> = {
  INITIAL_NOTIFICATION: "MOD_ANALYSIS",
  COUNTER_PROPOSAL: "MOD_NEGOTIATION",
  ACCEPTANCE: "MOD_EXECUTED",
};

// ─── Agent ───────────────────────────────────────────────────────────

export class ModCommunicationAgent extends BaseAgent {
  readonly name = "mod-communication";
  readonly type = "communication";
  readonly description =
    "Tracks modification communications, drafts responses, detects overdue items";

  private readonly mcp: ArcadeClient;
  private readonly config: Required<ModCommunicationConfig>;
  private readonly now: Date;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      config?: ModCommunicationConfig;
      now?: Date;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.config = {
      responseDueDays:
        options?.config?.responseDueDays ?? DEFAULT_RESPONSE_DUE_DAYS,
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId:
        options?.config?.teamsChannelId ?? "contracts-modifications",
    };
    this.now = options?.now ?? new Date();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload =
      task.triggerPayload as unknown as ModCommunicationPayload;

    await this.createAuditEntry(task.id, "RUNNING", {
      input: payload as unknown as Record<string, unknown>,
    });

    // Dispatch based on trigger type
    if (payload.emailContent) {
      return this.handleInboundEmail(task, payload.emailContent);
    }

    if (payload.scheduledCheck) {
      return this.handleOverdueCheck(task);
    }

    if (payload.draftResponse) {
      return this.handleDraftResponse(
        task,
        payload.draftResponse.modId,
        payload.draftResponse.contractId,
      );
    }

    return { success: false, error: "No recognized trigger in payload" };
  }

  // ─── Inbound email handler ─────────────────────────────────────────

  private async handleInboundEmail(
    task: AgentTask,
    email: InboundEmail,
  ): Promise<AgentResult> {
    // 1. Parse contract/mod references
    const refs = parseModReferences(email.subject, email.body);

    // 2. Resolve contract and mod IDs from DB
    const resolved = await this.resolveReferences(refs);

    // 3. Classify communication type via LLM
    const classification = await this.classifyCommunication(email);

    // 4. Calculate response due date
    const responseDueDate = calculateResponseDueDate(
      email.receivedAt,
      this.config.responseDueDays,
    );

    // 5. Store in communications_log
    await this.queryDatabase(
      `INSERT INTO contracts.communications_log
       (contract_id, mod_id, direction, channel, from_party, to_party,
        subject, body_preview, s3_key, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        resolved.contractId,
        resolved.modId,
        "INBOUND",
        "EMAIL",
        email.from,
        email.to,
        email.subject,
        email.body.slice(0, 500),
        email.s3Key ?? null,
        email.receivedAt,
      ],
    );

    // 6. Update FSM state if appropriate
    let fsmTransitioned = false;
    const targetState = COMM_TYPE_TO_FSM_STATE[classification.type];
    if (targetState && resolved.modId) {
      try {
        await this.transitionState(
          "MODIFICATION",
          resolved.modId,
          targetState,
          "system",
          "system",
        );
        fsmTransitioned = true;
      } catch {
        // Transition not valid from current state — skip
      }
    }

    // 7. Alert contracts team via Teams
    await this.sendTeamsAlert(email, classification, resolved, responseDueDate);

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { from: email.from, subject: email.subject },
      output: {
        contractNumber: refs.contractNumber,
        modNumber: refs.modNumber,
        classificationType: classification.type,
        fsmTransitioned,
        responseDueDate: responseDueDate.toISOString(),
      },
    });

    return {
      success: true,
      data: {
        contractNumber: refs.contractNumber,
        modNumber: refs.modNumber,
        contractId: resolved.contractId,
        modId: resolved.modId,
        classificationType: classification.type,
        classificationConfidence: classification.confidence,
        responseDueDate: responseDueDate.toISOString(),
        fsmTransitioned,
      },
    };
  }

  // ─── Overdue check handler ─────────────────────────────────────────

  private async handleOverdueCheck(task: AgentTask): Promise<AgentResult> {
    // Find mods in review/submitted states with approaching due dates
    const rows = await this.queryDatabase(
      `SELECT m.id, m.mod_number, m.status, c.contract_number,
              cl.received_at
       FROM contracts.modifications m
       JOIN contracts.contracts c ON c.id = m.contract_id
       LEFT JOIN contracts.communications_log cl
         ON cl.mod_id = m.id AND cl.direction = 'INBOUND'
       WHERE m.status IN ('MOD_UNDER_REVIEW', 'MOD_SUBMITTED')
       ORDER BY cl.received_at ASC`,
      [],
    );

    const alerts: OverdueAlert[] = [];

    for (const row of rows as any[]) {
      if (!row.received_at) continue;

      const dueDate = calculateResponseDueDate(
        row.received_at,
        this.config.responseDueDays,
      );
      const daysRemaining = Math.floor(
        (dueDate.getTime() - this.now.getTime()) / MS_PER_DAY,
      );

      let severity: OverdueAlert["severity"] | null = null;
      if (daysRemaining < 0) {
        severity = "OVERDUE";
      } else if (daysRemaining <= 3) {
        severity = "URGENT";
      } else if (daysRemaining <= 7) {
        severity = "WARNING";
      }

      if (severity) {
        alerts.push({
          modId: row.id,
          contractNumber: row.contract_number,
          modNumber: row.mod_number,
          status: row.status,
          responseDueDate: dueDate.toISOString(),
          daysRemaining,
          severity,
        });
      }
    }

    // Send Teams notifications for each alert
    for (const alert of alerts) {
      await this.sendOverdueTeamsAlert(alert);
    }

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { scheduledCheck: true },
      output: { alertCount: alerts.length },
    });

    return {
      success: true,
      data: {
        alertCount: alerts.length,
        alerts: alerts as unknown as Record<string, unknown>,
      },
    };
  }

  // ─── Draft response handler ────────────────────────────────────────

  private async handleDraftResponse(
    task: AgentTask,
    modId: string,
    contractId: string,
  ): Promise<AgentResult> {
    // Load contract context
    const ctx = await this.getContractContext(contractId);

    // Load modification details
    const modRows = await this.queryDatabase(
      `SELECT mod_number, mod_type, effective_date, description,
              ceiling_delta, funding_delta, sf30_reference
       FROM contracts.modifications
       WHERE id = $1`,
      [modId],
    );

    if (modRows.length === 0) {
      return { success: false, error: `Modification not found: ${modId}` };
    }

    const mod = modRows[0] as any;

    // Load latest inbound communication for context
    const commRows = await this.queryDatabase(
      `SELECT subject, body_preview, from_party, received_at
       FROM contracts.communications_log
       WHERE mod_id = $1 AND direction = 'INBOUND'
       ORDER BY received_at DESC LIMIT 1`,
      [modId],
    );

    const latestComm = (commRows[0] as any) ?? null;

    // Draft response via LLM
    const draftText = await this.callLLM(
      this.buildDraftPrompt(ctx, mod, latestComm),
      { temperature: 0.3, maxTokens: 4096 },
    );

    // Pre-populate SF-30 fields
    const sf30: SF30Fields = {
      contractNumber: ctx.contractNumber,
      modNumber: mod.mod_number,
      effectiveDate: mod.effective_date,
      contractingOfficer: ctx.contractNumber
        ? await this.lookupCO(contractId)
        : "",
      contractor: "Dynamo Technologies, Inc.",
      description: mod.description ?? "",
      ceilingDelta: mod.ceiling_delta ?? "0.00",
      fundingDelta: mod.funding_delta ?? "0.00",
    };

    // Log the outbound draft in communications_log
    await this.queryDatabase(
      `INSERT INTO contracts.communications_log
       (contract_id, mod_id, direction, channel, from_party, to_party,
        subject, body_preview, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contractId,
        modId,
        "OUTBOUND",
        "LETTER",
        "Dynamo Technologies, Inc.",
        sf30.contractingOfficer,
        `Response to ${mod.mod_number}`,
        draftText.slice(0, 500),
        new Date().toISOString(),
      ],
    );

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { modId, contractId },
      output: { modNumber: mod.mod_number, sf30Populated: true },
    });

    return {
      success: true,
      data: {
        modId,
        contractId,
        modNumber: mod.mod_number,
        draftText,
        sf30: sf30 as unknown as Record<string, unknown>,
      },
    };
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private async resolveReferences(refs: {
    contractNumber: string | null;
    modNumber: string | null;
  }): Promise<ParsedModReference> {
    const result: ParsedModReference = {
      contractNumber: refs.contractNumber,
      modNumber: refs.modNumber,
      contractId: null,
      modId: null,
    };

    if (refs.contractNumber) {
      const rows = await this.queryDatabase(
        `SELECT id FROM contracts.contracts WHERE contract_number = $1`,
        [refs.contractNumber],
      );
      if (rows.length > 0) {
        result.contractId = (rows[0] as any).id;
      }
    }

    if (refs.modNumber && result.contractId) {
      const rows = await this.queryDatabase(
        `SELECT id FROM contracts.modifications
         WHERE contract_id = $1 AND mod_number = $2`,
        [result.contractId, refs.modNumber],
      );
      if (rows.length > 0) {
        result.modId = (rows[0] as any).id;
      }
    }

    return result;
  }

  private async classifyCommunication(
    email: InboundEmail,
  ): Promise<CommClassification> {
    const prompt = `You are a government contracts communication classifier.

Classify this email regarding a contract modification:

From: ${email.from}
Subject: ${email.subject}
Body:
${email.body.slice(0, 2000)}

Classify as one of:
- INITIAL_NOTIFICATION: First notice of a modification from the Contracting Officer
- COUNTER_PROPOSAL: A counter-offer or revised terms
- REQUEST_FOR_INFORMATION: Asking for additional information or clarification
- ACCEPTANCE: Formal acceptance of modification terms
- REJECTION: Formal rejection or denial

Respond with ONLY valid JSON:
{"type": "...", "confidence": 0.0-1.0}`;

    const raw = await this.callLLM(prompt, {
      temperature: 0.1,
      maxTokens: 256,
    });
    return parseClassificationResponse(raw);
  }

  private buildDraftPrompt(
    ctx: any,
    mod: any,
    latestComm: any,
  ): string {
    const commContext = latestComm
      ? `\nLatest inbound communication:\nFrom: ${latestComm.from_party}\nSubject: ${latestComm.subject}\nBody: ${latestComm.body_preview ?? "N/A"}`
      : "";

    return `You are a government contracts specialist at Dynamo Technologies, Inc.

Draft a professional response letter for the following contract modification:

Contract: ${ctx.contractNumber} (${ctx.contractType})
Agency: ${ctx.awardingAgency}
Contract Value: $${ctx.ceilingValue}
Modification: ${mod.mod_number}
Mod Type: ${mod.mod_type}
Description: ${mod.description ?? "N/A"}
Ceiling Change: $${mod.ceiling_delta ?? "0.00"}
Funding Change: $${mod.funding_delta ?? "0.00"}
${commContext}

Draft a formal response letter. Include:
1. Reference to the modification and contract number
2. Acknowledgment of the modification terms
3. Any conditions or clarifications
4. Request for bilateral signature if applicable
5. Professional closing

Respond with ONLY the letter text.`;
  }

  private async lookupCO(contractId: string): Promise<string> {
    const rows = await this.queryDatabase(
      `SELECT contracting_officer_name
       FROM contracts.contracts WHERE id = $1`,
      [contractId],
    );
    return rows.length > 0
      ? (rows[0] as any).contracting_officer_name
      : "Contracting Officer";
  }

  private async sendTeamsAlert(
    email: InboundEmail,
    classification: CommClassification,
    resolved: ParsedModReference,
    responseDueDate: Date,
  ) {
    const message = [
      `**New Modification Communication Received**`,
      `**Type:** ${classification.type.replace(/_/g, " ")}`,
      `**From:** ${email.from}`,
      `**Subject:** ${email.subject}`,
      `**Contract:** ${resolved.contractNumber ?? "Unknown"}`,
      `**Mod:** ${resolved.modNumber ?? "Unknown"}`,
      `**Response Due:** ${responseDueDate.toISOString().split("T")[0]}`,
    ].join("\n");

    return this.mcp.executeTool("microsoft.teams.sendMessage", {
      channelId: this.config.teamsChannelId,
      message,
    });
  }

  private async sendOverdueTeamsAlert(alert: OverdueAlert) {
    const icon =
      alert.severity === "OVERDUE"
        ? "OVERDUE"
        : alert.severity === "URGENT"
          ? "URGENT"
          : "WARNING";

    const message = [
      `**[${icon}] Modification Response ${alert.severity}**`,
      `**Contract:** ${alert.contractNumber}`,
      `**Mod:** ${alert.modNumber} (${alert.status})`,
      `**Response Due:** ${alert.responseDueDate.split("T")[0]}`,
      `**Days Remaining:** ${alert.daysRemaining}`,
      alert.daysRemaining < 0
        ? `Response is ${Math.abs(alert.daysRemaining)} day(s) overdue!`
        : `Response due in ${alert.daysRemaining} day(s).`,
    ].join("\n");

    return this.mcp.executeTool("microsoft.teams.sendMessage", {
      channelId: this.config.teamsChannelId,
      message,
    });
  }
}
