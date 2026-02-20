/**
 * Document Generation Agent
 *
 * Generates Word documents from templates using contract data.
 * Supports NDAs, MOUs, option exercise letters, funding action
 * requests, and modification cover letters.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";
import {
  TemplateEngine,
  type Template,
} from "./helpers/template-engine.js";

// ─── Types ───────────────────────────────────────────────────────────

export type DocumentType =
  | "NDA_MUTUAL"
  | "NDA_UNILATERAL"
  | "MOU"
  | "OPTION_EXERCISE_LETTER"
  | "FUNDING_ACTION_REQUEST"
  | "MOD_COVER_LETTER";

export interface DocumentGenerationPayload {
  documentType: DocumentType;
  contractId?: string;
  requestId?: string;
  jiraKey?: string;
  requesterEmail?: string;
  ndaId?: string;
  mouId?: string;
  optionId?: string;
  modId?: string;
  additionalData?: Record<string, unknown>;
}

export interface DocumentGenerationConfig {
  jiraProject?: string;
  teamsChannelId?: string;
}

// ─── Template mapping ────────────────────────────────────────────────

export const TEMPLATE_MAP: Record<DocumentType, string> = {
  NDA_MUTUAL: "nda_mutual.docx",
  NDA_UNILATERAL: "nda_unilateral.docx",
  MOU: "mou.docx",
  OPTION_EXERCISE_LETTER: "option_exercise_letter.docx",
  FUNDING_ACTION_REQUEST: "funding_action_request.docx",
  MOD_COVER_LETTER: "mod_cover_letter.docx",
};

export const REQUIRED_FIELDS: Record<DocumentType, string[]> = {
  NDA_MUTUAL: ["effectiveDate", "expirationDate", "party1Name", "party2Name", "scope"],
  NDA_UNILATERAL: ["effectiveDate", "expirationDate", "disclosingPartyName", "receivingPartyName", "scope"],
  MOU: ["effectiveDate", "purpose"],
  OPTION_EXERCISE_LETTER: ["contractNumber", "optionNumber", "exerciseBy"],
  FUNDING_ACTION_REQUEST: ["contractNumber", "ceilingValue", "fundedValue"],
  MOD_COVER_LETTER: ["contractNumber", "modNumber", "effectiveDate"],
};

// ─── Agent ───────────────────────────────────────────────────────────

export class DocumentGenerationAgent extends BaseAgent {
  readonly name = "document-generation";
  readonly type = "document_generation";
  readonly description =
    "Generates contract documents from templates using structured data";

  private readonly mcp: ArcadeClient;
  private readonly engine: TemplateEngine;
  private readonly config: Required<DocumentGenerationConfig>;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      engine?: TemplateEngine;
      config?: DocumentGenerationConfig;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.engine = options?.engine ?? new TemplateEngine();
    this.config = {
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId:
        options?.config?.teamsChannelId ?? "contracts-documents",
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload =
      task.triggerPayload as unknown as DocumentGenerationPayload;
    const { documentType } = payload;

    await this.createAuditEntry(task.id, "RUNNING", {
      input: { documentType, contractId: payload.contractId },
    });

    // 1. Load template
    const templateName = TEMPLATE_MAP[documentType];
    if (!templateName) {
      return {
        success: false,
        error: `Unknown document type: ${documentType}`,
      };
    }

    const template = this.engine.loadTemplate(templateName);
    if (!template) {
      return {
        success: false,
        error: `Template not found: ${templateName}`,
      };
    }

    // 2. Load data based on document type
    const data = await this.loadDocumentData(payload);

    // 3. Validate required fields
    const requiredFields = REQUIRED_FIELDS[documentType] ?? [];
    const missing = requiredFields.filter(
      (f) => data[f] === undefined || data[f] === null || data[f] === "",
    );
    if (missing.length > 0) {
      return {
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
        needsReview: true,
        reviewReason: `Document generation blocked — missing: ${missing.join(", ")}`,
      };
    }

    // 4. Populate template
    const content = this.engine.populate(template, data);

    // 5. Store in S3
    const s3Key = `documents/${documentType.toLowerCase()}/${payload.contractId ?? "general"}/${Date.now()}.docx`;

    await this.mcp.executeTool("s3.putObject", {
      bucket: "forge-documents",
      key: s3Key,
      content,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // 6. Link to Jira if ticket provided
    if (payload.jiraKey) {
      await this.mcp.executeTool("jira.addComment", {
        issueKey: payload.jiraKey,
        comment: `Document generated: [${templateName}](s3://${s3Key})\nType: ${documentType}`,
      });
    }

    // 7. Notify requester via Teams
    if (payload.requesterEmail) {
      await this.mcp.executeTool("microsoft.teams.sendMessage", {
        channelId: this.config.teamsChannelId,
        message: [
          `**Document Generated**`,
          `**Type:** ${documentType.replace(/_/g, " ")}`,
          `**Requester:** ${payload.requesterEmail}`,
          `**Location:** s3://${s3Key}`,
          payload.jiraKey ? `**Jira:** ${payload.jiraKey}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { documentType, contractId: payload.contractId },
      output: { s3Key },
    });

    return {
      success: true,
      data: {
        documentType,
        s3Key,
        templateUsed: templateName,
        content,
      },
    };
  }

  // ─── Data loaders ──────────────────────────────────────────────────

  private async loadDocumentData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    const base: Record<string, unknown> = {
      currentDate: new Date().toISOString().split("T")[0],
      ...(payload.additionalData ?? {}),
    };

    switch (payload.documentType) {
      case "NDA_MUTUAL":
      case "NDA_UNILATERAL":
        return { ...base, ...(await this.loadNdaData(payload)) };
      case "MOU":
        return { ...base, ...(await this.loadMouData(payload)) };
      case "OPTION_EXERCISE_LETTER":
        return { ...base, ...(await this.loadOptionData(payload)) };
      case "FUNDING_ACTION_REQUEST":
        return { ...base, ...(await this.loadFundingData(payload)) };
      case "MOD_COVER_LETTER":
        return { ...base, ...(await this.loadModCoverData(payload)) };
      default:
        return base;
    }
  }

  private async loadNdaData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    if (!payload.ndaId) return {};

    const rows = await this.queryDatabase(
      `SELECT n.nda_type, n.effective_date, n.expiration_date,
              n.scope_description,
              pa.name AS party_a_name, pa.address AS party_a_address,
              pb.name AS party_b_name, pb.address AS party_b_address
       FROM contracts.ndas n
       JOIN contracts.parties pa ON pa.id = n.party_a_id
       JOIN contracts.parties pb ON pb.id = n.party_b_id
       WHERE n.id = $1`,
      [payload.ndaId],
    );

    if (rows.length === 0) return {};

    const nda = rows[0] as any;
    const isMutual = nda.nda_type === "MUTUAL";

    const data: Record<string, unknown> = {
      effectiveDate: nda.effective_date,
      expirationDate: nda.expiration_date,
      scope: nda.scope_description,
      mutual: isMutual,
      unilateral: !isMutual,
    };

    if (isMutual) {
      data.party1Name = nda.party_a_name;
      data.party1Address = nda.party_a_address;
      data.party2Name = nda.party_b_name;
      data.party2Address = nda.party_b_address;
    } else {
      data.disclosingPartyName = nda.party_a_name;
      data.disclosingPartyAddress = nda.party_a_address;
      data.receivingPartyName = nda.party_b_name;
      data.receivingPartyAddress = nda.party_b_address;
    }

    // Add contract context if available
    if (payload.contractId) {
      try {
        const ctx = await this.getContractContext(payload.contractId);
        data.governmentContract = true;
        data.contractNumber = ctx.contractNumber;
        data.awardingAgency = ctx.awardingAgency;
      } catch {
        data.governmentContract = false;
      }
    }

    return data;
  }

  private async loadMouData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    if (!payload.mouId) return {};

    const mouRows = await this.queryDatabase(
      `SELECT effective_date, expiration_date, purpose, obligations_summary
       FROM contracts.mous
       WHERE id = $1`,
      [payload.mouId],
    );

    if (mouRows.length === 0) return {};

    const mou = mouRows[0] as any;

    const partyRows = await this.queryDatabase(
      `SELECT p.name, mp.role, p.address
       FROM contracts.mou_parties mp
       JOIN contracts.parties p ON p.id = mp.party_id
       WHERE mp.mou_id = $1`,
      [payload.mouId],
    );

    return {
      effectiveDate: mou.effective_date,
      expirationDate: mou.expiration_date,
      purpose: mou.purpose,
      obligations: mou.obligations_summary ?? "",
      parties: (partyRows as any[]).map((p) => ({
        name: p.name,
        role: p.role,
        contactName: "",
        contactEmail: "",
      })),
    };
  }

  private async loadOptionData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    if (!payload.optionId || !payload.contractId) return {};

    const optRows = await this.queryDatabase(
      `SELECT option_number, option_start, option_end,
              option_value, exercise_deadline, status
       FROM contracts.contract_options
       WHERE id = $1`,
      [payload.optionId],
    );

    if (optRows.length === 0) return {};

    const opt = optRows[0] as any;
    const ctx = await this.getContractContext(payload.contractId);

    return {
      contractNumber: ctx.contractNumber,
      contractingOfficer: await this.lookupCO(payload.contractId),
      optionNumber: opt.option_number,
      optionStart: opt.option_start,
      optionEnd: opt.option_end,
      optionValue: opt.option_value,
      exerciseBy: opt.exercise_deadline,
      ceilingValue: ctx.ceilingValue,
      fundedValue: ctx.fundedValue,
      exerciseRequested: true,
      notificationOnly: false,
    };
  }

  private async loadFundingData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    if (!payload.contractId) return {};

    const ctx = await this.getContractContext(payload.contractId);

    const clinRows = await this.queryDatabase(
      `SELECT clin_number, description, funded_amount, total_value
       FROM contracts.clins
       WHERE contract_id = $1`,
      [payload.contractId],
    );

    const ceiling = parseFloat(ctx.ceilingValue);
    const funded = parseFloat(ctx.fundedValue);

    return {
      contractNumber: ctx.contractNumber,
      awardingAgency: ctx.awardingAgency,
      ceilingValue: ctx.ceilingValue,
      fundedValue: ctx.fundedValue,
      ceilingRemaining: (ceiling - funded).toFixed(2),
      popStart: ctx.popStart,
      popEnd: ctx.popEnd,
      clins: (clinRows as any[]).map((c) => ({
        clinNumber: c.clin_number,
        description: c.description,
        fundedAmount: c.funded_amount,
        totalValue: c.total_value,
      })),
    };
  }

  private async loadModCoverData(
    payload: DocumentGenerationPayload,
  ): Promise<Record<string, unknown>> {
    if (!payload.modId || !payload.contractId) return {};

    const modRows = await this.queryDatabase(
      `SELECT mod_number, mod_type, effective_date, description,
              ceiling_delta, funding_delta, sf30_reference
       FROM contracts.modifications
       WHERE id = $1`,
      [payload.modId],
    );

    if (modRows.length === 0) return {};

    const mod = modRows[0] as any;
    const ctx = await this.getContractContext(payload.contractId);

    return {
      contractNumber: ctx.contractNumber,
      awardingAgency: ctx.awardingAgency,
      contractingOfficer: await this.lookupCO(payload.contractId),
      modNumber: mod.mod_number,
      modType: mod.mod_type,
      effectiveDate: mod.effective_date,
      description: mod.description ?? "",
      ceilingDelta: mod.ceiling_delta ?? "0.00",
      fundingDelta: mod.funding_delta ?? "0.00",
      sf30Reference: mod.sf30_reference ?? null,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

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
}
