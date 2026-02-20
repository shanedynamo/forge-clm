/**
 * Flowdown Generator Agent
 *
 * Determines which prime contract clauses flow down to subcontracts,
 * generates the flowdown matrix, drafts subcontract language via LLM,
 * and produces documentation for Contract Manager review.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface FlowdownGeneratorPayload {
  contractId: string;
  subcontractId: string;
  triggerReason?: "NEW_SUBCONTRACT" | "PRIME_MODIFICATION";
}

export type FlowdownBasis =
  | "MANDATORY"
  | "THRESHOLD"
  | "EXEMPTED"
  | "NOT_APPLICABLE";

export interface FlowdownMatrixEntry {
  prime_clause: string;
  clause_title: string;
  clause_type: string;
  flows_down: boolean;
  basis: FlowdownBasis;
  modification_needed: string | null;
  notes: string;
}

export interface FlowdownGeneratorConfig {
  jiraProject?: string;
  teamsChannelId?: string;
}

export interface SubcontractProfile {
  id: string;
  subcontractorName: string;
  subcontractorCage: string | null;
  subType: string;
  ceilingValue: number;
  businessSize: string | null;
  handlesCui: boolean;
  exportControlled: boolean;
  primeContractId: string;
}

export interface PrimeClause {
  id: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseType: string;
  flowdownRequired: boolean;
}

// ─── Flowdown Determination Rules ────────────────────────────────────

export interface FlowdownDeterminationRule {
  clausePattern: string;
  dollarThreshold: number | null;
  smallBusinessExempt: boolean;
  exemptBusinessSizes: string[];
  requiresCui: boolean;
  requiresExportControl: boolean;
  notes: string;
}

export const FLOWDOWN_RULES: FlowdownDeterminationRule[] = [
  {
    clausePattern: "52.222-26",
    dollarThreshold: 10_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Equal Opportunity — required for subcontracts exceeding $10,000",
  },
  {
    clausePattern: "52.222-35",
    dollarThreshold: 150_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Equal Opportunity for Veterans — required above $150K",
  },
  {
    clausePattern: "52.222-36",
    dollarThreshold: 15_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Equal Opportunity for Workers with Disabilities — required above $15K",
  },
  {
    clausePattern: "52.219-8",
    dollarThreshold: 150_000,
    smallBusinessExempt: true,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Utilization of Small Business Concerns — exempt for small business subs",
  },
  {
    clausePattern: "52.219-9",
    dollarThreshold: 750_000,
    smallBusinessExempt: true,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Small Business Subcontracting Plan — exempt for small business subs",
  },
  {
    clausePattern: "52.215-2",
    dollarThreshold: 750_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Audit and Records — Negotiation — required above $750K",
  },
  {
    clausePattern: "52.222-41",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Service Contract Labor Standards — mandatory flowdown",
  },
  {
    clausePattern: "52.222-50",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Combating Trafficking in Persons — mandatory flowdown",
  },
  {
    clausePattern: "52.223-6",
    dollarThreshold: 150_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Drug-Free Workplace — required above $150K",
  },
  {
    clausePattern: "52.204-21",
    dollarThreshold: 10_000,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Basic Safeguarding of Covered Contractor Information Systems — required above $10K",
  },
  {
    clausePattern: "252.204-7012",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: true,
    requiresExportControl: false,
    notes: "Safeguarding Covered Defense Information — only if sub handles CUI",
  },
  {
    clausePattern: "252.225-7001",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Buy American and Balance of Payments — mandatory flowdown",
  },
  {
    clausePattern: "252.225-7048",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: true,
    notes: "Export-Controlled Items — only if sub performs export-controlled work",
  },
  {
    clausePattern: "252.227-7013",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Rights in Technical Data — Noncommercial Items — mandatory flowdown",
  },
  {
    clausePattern: "252.227-7014",
    dollarThreshold: null,
    smallBusinessExempt: false,
    exemptBusinessSizes: [],
    requiresCui: false,
    requiresExportControl: false,
    notes: "Rights in Noncommercial Computer Software — mandatory flowdown",
  },
];

// ─── Clause library entry (internal) ─────────────────────────────────

interface ClauseLibraryEntry {
  clauseNumber: string;
  title: string;
  flowdownApplicability: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function findMatchingRule(
  clauseNumber: string,
): FlowdownDeterminationRule | null {
  for (const rule of FLOWDOWN_RULES) {
    if (clauseNumber.startsWith(rule.clausePattern)) {
      return rule;
    }
  }
  return null;
}

/**
 * Determine whether a single prime clause flows down to a subcontract.
 * Exported for unit-test visibility.
 */
export function determineClauseFlowdown(
  clause: PrimeClause,
  sub: SubcontractProfile,
  libraryEntry: ClauseLibraryEntry | null,
): FlowdownMatrixEntry {
  const base = {
    prime_clause: clause.clauseNumber,
    clause_title: clause.clauseTitle,
    clause_type: clause.clauseType,
    modification_needed: null as string | null,
  };

  const rule = findMatchingRule(clause.clauseNumber);

  if (rule) {
    // 1. Dollar threshold
    if (
      rule.dollarThreshold !== null &&
      sub.ceilingValue <= rule.dollarThreshold
    ) {
      return {
        ...base,
        flows_down: false,
        basis: "THRESHOLD",
        notes: `Exempt: subcontract value ($${sub.ceilingValue.toLocaleString()}) at or below $${rule.dollarThreshold.toLocaleString()} threshold`,
      };
    }

    // 2. Small business exemption (any non-LARGE)
    const isSmallBusiness =
      sub.businessSize !== null && sub.businessSize !== "LARGE";
    if (rule.smallBusinessExempt && isSmallBusiness) {
      return {
        ...base,
        flows_down: false,
        basis: "EXEMPTED",
        notes: `Small business exemption: ${sub.businessSize} subcontractor exempt from ${clause.clauseNumber}`,
      };
    }

    // 3. Specific business-size exemptions
    if (
      rule.exemptBusinessSizes.length > 0 &&
      sub.businessSize !== null &&
      rule.exemptBusinessSizes.includes(sub.businessSize)
    ) {
      return {
        ...base,
        flows_down: false,
        basis: "EXEMPTED",
        notes: `Business size exemption: ${sub.businessSize} exempt from ${clause.clauseNumber}`,
      };
    }

    // 4. CUI work-type filter
    if (rule.requiresCui && !sub.handlesCui) {
      return {
        ...base,
        flows_down: false,
        basis: "NOT_APPLICABLE",
        notes: "Subcontractor does not handle CUI — clause not applicable",
      };
    }

    // 5. Export-control work-type filter
    if (rule.requiresExportControl && !sub.exportControlled) {
      return {
        ...base,
        flows_down: false,
        basis: "NOT_APPLICABLE",
        notes:
          "Subcontractor does not perform export-controlled work — clause not applicable",
      };
    }

    // Clause flows down
    return {
      ...base,
      flows_down: true,
      basis: rule.dollarThreshold !== null ? "THRESHOLD" : "MANDATORY",
      notes: rule.notes,
    };
  }

  // No built-in rule — check clause library
  if (libraryEntry?.flowdownApplicability) {
    const app = libraryEntry.flowdownApplicability.toLowerCase();
    if (app.includes("mandatory") || app.includes("required")) {
      return {
        ...base,
        flows_down: true,
        basis: "MANDATORY",
        notes: `Mandatory per clause library: ${libraryEntry.flowdownApplicability}`,
      };
    }
  }

  // Check clause-level flag
  if (clause.flowdownRequired) {
    return {
      ...base,
      flows_down: true,
      basis: "MANDATORY",
      notes: "Flowdown required per contract clause designation",
    };
  }

  // Default: not applicable
  return {
    ...base,
    flows_down: false,
    basis: "NOT_APPLICABLE",
    notes: "No flowdown requirement identified",
  };
}

// ─── Agent ───────────────────────────────────────────────────────────

export class FlowdownGeneratorAgent extends BaseAgent {
  readonly name = "flowdown-generator";
  readonly type = "document_generation";
  readonly description =
    "Determines prime clause flowdown to subcontracts, generates matrix and draft language";

  private readonly mcp: ArcadeClient;
  private readonly config: Required<FlowdownGeneratorConfig>;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      config?: FlowdownGeneratorConfig;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.config = {
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId: options?.config?.teamsChannelId ?? "contracts-flowdown",
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload =
      task.triggerPayload as unknown as FlowdownGeneratorPayload;
    const { contractId, subcontractId } = payload;

    await this.createAuditEntry(task.id, "RUNNING", {
      input: { contractId, subcontractId },
    });

    // 1. Load prime contract clauses
    const clauseRows = await this.queryDatabase(
      `SELECT id, clause_number, clause_title, clause_type, flowdown_required
       FROM contracts.contract_clauses
       WHERE contract_id = $1`,
      [contractId],
    );

    const clauses: PrimeClause[] = clauseRows.map((r: any) => ({
      id: r.id,
      clauseNumber: r.clause_number,
      clauseTitle: r.clause_title,
      clauseType: r.clause_type,
      flowdownRequired: r.flowdown_required ?? false,
    }));

    // 2. Load subcontractor profile
    const subProfile = await this.loadSubcontractProfile(subcontractId);

    // 3. Load clause library entries
    const libraryMap = await this.loadClauseLibrary(clauses);

    // 4. Determine flowdown for each clause
    const matrix: FlowdownMatrixEntry[] = [];
    for (const clause of clauses) {
      const libraryEntry = libraryMap.get(clause.clauseNumber) ?? null;
      matrix.push(determineClauseFlowdown(clause, subProfile, libraryEntry));
    }

    // 5. Draft subcontract language for flowing clauses via LLM
    let draftLanguageCount = 0;
    for (const entry of matrix) {
      if (entry.flows_down) {
        const draft = await this.draftSubcontractLanguage(entry, subProfile);
        if (draft) {
          entry.modification_needed = draft;
          draftLanguageCount++;
        }
      }
    }

    // 6. Store in flowdown_requirements table
    await this.storeFlowdownRequirements(matrix, clauses, subcontractId);

    // 7. Generate Word document with matrix
    const docResult = await this.generateFlowdownDocument(
      matrix,
      contractId,
      subProfile,
    );

    // 8. Create Jira ticket for CM review
    const jiraResult = await this.createJiraTicket(
      matrix,
      contractId,
      subProfile,
      docResult,
    );
    const jiraKey = jiraResult.data.issueKey as string;

    const flowdownCount = matrix.filter((e) => e.flows_down).length;
    const exemptedCount = matrix.filter((e) => !e.flows_down).length;

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { contractId, subcontractId },
      output: {
        totalClauses: matrix.length,
        flowdownCount,
        exemptedCount,
        draftLanguageCount,
        jiraKey,
      },
    });

    return {
      success: true,
      data: {
        contractId,
        subcontractId,
        totalClauses: matrix.length,
        flowdownCount,
        exemptedCount,
        draftLanguageCount,
        matrix: matrix as unknown as Record<string, unknown>,
        jiraKey,
      },
    };
  }

  // ─── Subcontract profile loader ────────────────────────────────────

  private async loadSubcontractProfile(
    subcontractId: string,
  ): Promise<SubcontractProfile> {
    const rows = await this.queryDatabase(
      `SELECT s.id, s.subcontractor_name, s.subcontractor_cage, s.sub_type,
              s.ceiling_value, s.prime_contract_id,
              p.business_size
       FROM contracts.subcontracts s
       LEFT JOIN contracts.parties p ON p.cage_code = s.subcontractor_cage
       WHERE s.id = $1`,
      [subcontractId],
    );

    if (rows.length === 0) {
      throw new Error(`Subcontract not found: ${subcontractId}`);
    }

    const row = rows[0] as any;
    const subType = (row.sub_type ?? "").toLowerCase();

    return {
      id: row.id,
      subcontractorName: row.subcontractor_name,
      subcontractorCage: row.subcontractor_cage,
      subType: row.sub_type,
      ceilingValue: parseFloat(row.ceiling_value),
      businessSize: row.business_size ?? null,
      handlesCui: subType.includes("cui") || subType.includes("cyber"),
      exportControlled:
        subType.includes("itar") || subType.includes("export"),
      primeContractId: row.prime_contract_id,
    };
  }

  // ─── Clause library loader ─────────────────────────────────────────

  private async loadClauseLibrary(
    clauses: PrimeClause[],
  ): Promise<Map<string, ClauseLibraryEntry>> {
    if (clauses.length === 0) return new Map();

    const clauseNumbers = clauses.map((c) => c.clauseNumber);
    const placeholders = clauseNumbers
      .map((_, i) => `$${i + 1}`)
      .join(", ");

    const rows = await this.queryDatabase(
      `SELECT clause_number, title, flowdown_applicability
       FROM contracts.clause_library
       WHERE clause_number IN (${placeholders})`,
      clauseNumbers,
    );

    const map = new Map<string, ClauseLibraryEntry>();
    for (const row of rows as any[]) {
      map.set(row.clause_number, {
        clauseNumber: row.clause_number,
        title: row.title,
        flowdownApplicability: row.flowdown_applicability,
      });
    }
    return map;
  }

  // ─── LLM draft language ────────────────────────────────────────────

  private async draftSubcontractLanguage(
    entry: FlowdownMatrixEntry,
    sub: SubcontractProfile,
  ): Promise<string | null> {
    const prompt = `You are a government contracts specialist drafting flowdown clause language for a subcontract.

Prime contract clause: ${entry.prime_clause} — ${entry.clause_title}
Clause type: ${entry.clause_type}
Subcontractor: ${sub.subcontractorName}
Subcontract type: ${sub.subType}
Subcontract value: $${sub.ceilingValue.toLocaleString()}
Business size: ${sub.businessSize ?? "Unknown"}

Draft appropriate subcontract language that adapts this prime contract clause for the subcontract context. Key modifications:
- Replace "Contractor" with "Subcontractor" where appropriate
- Replace direct "Government" references to flow through the prime contractor
- Adjust any dollar thresholds for the subcontract level
- Add prime contractor oversight provisions as needed

If no modification is needed and the clause should flow down verbatim, respond with exactly: VERBATIM

Otherwise, respond with ONLY the modified clause language text.`;

    const response = await this.callLLM(prompt, {
      temperature: 0.2,
      maxTokens: 2048,
    });

    const trimmed = response.trim();
    return trimmed === "VERBATIM" ? null : trimmed;
  }

  // ─── Store flowdown requirements ───────────────────────────────────

  private async storeFlowdownRequirements(
    matrix: FlowdownMatrixEntry[],
    clauses: PrimeClause[],
    subcontractId: string,
  ): Promise<void> {
    const clauseIdMap = new Map<string, string>();
    for (const clause of clauses) {
      clauseIdMap.set(clause.clauseNumber, clause.id);
    }

    for (const entry of matrix) {
      const clauseId = clauseIdMap.get(entry.prime_clause);
      if (!clauseId) continue;

      const status = entry.flows_down ? "REQUIRED" : "WAIVED";
      const waiver = entry.flows_down ? null : entry.notes;

      await this.queryDatabase(
        `INSERT INTO contracts.flowdown_requirements
         (prime_clause_id, sub_contract_id, flowdown_status, waiver_justification)
         VALUES ($1, $2, $3, $4)`,
        [clauseId, subcontractId, status, waiver],
      );
    }
  }

  // ─── Word document generation ──────────────────────────────────────

  private async generateFlowdownDocument(
    matrix: FlowdownMatrixEntry[],
    contractId: string,
    sub: SubcontractProfile,
  ) {
    const tableRows = matrix.map((entry) => [
      entry.prime_clause,
      entry.clause_title,
      entry.clause_type,
      entry.flows_down ? "YES" : "NO",
      entry.basis,
      entry.notes,
    ]);

    const sections: Record<string, unknown>[] = [
      {
        heading: "Flowdown Requirements Matrix",
        content: [
          `Contract: ${contractId}`,
          `Subcontractor: ${sub.subcontractorName}`,
          `Subcontract Value: $${sub.ceilingValue.toLocaleString()}`,
          `Business Size: ${sub.businessSize ?? "Not specified"}`,
          `Total Clauses: ${matrix.length}`,
          `Flowing Down: ${matrix.filter((e) => e.flows_down).length}`,
          `Exempted/N/A: ${matrix.filter((e) => !e.flows_down).length}`,
        ].join("\n"),
      },
      {
        heading: "Clause Flowdown Matrix",
        table: {
          headers: [
            "Clause",
            "Title",
            "Type",
            "Flows Down",
            "Basis",
            "Notes",
          ],
          rows: tableRows,
        },
      },
    ];

    const modifiedClauses = matrix.filter((e) => e.modification_needed);
    if (modifiedClauses.length > 0) {
      sections.push({
        heading: "Modified Clause Language for Subcontract",
        content: modifiedClauses
          .map(
            (e) =>
              `### ${e.prime_clause} — ${e.clause_title}\n\n${e.modification_needed}`,
          )
          .join("\n\n---\n\n"),
      });
    }

    return this.mcp.executeTool("microsoft.word.createDocument", {
      title: `Flowdown Matrix — ${sub.subcontractorName} — Contract ${contractId}`,
      sections,
    });
  }

  // ─── Jira ticket ───────────────────────────────────────────────────

  private async createJiraTicket(
    matrix: FlowdownMatrixEntry[],
    contractId: string,
    sub: SubcontractProfile,
    docResult: { data: Record<string, unknown> },
  ) {
    const flowdownCount = matrix.filter((e) => e.flows_down).length;
    const exemptedCount = matrix.filter((e) => !e.flows_down).length;
    const modifiedCount = matrix.filter(
      (e) => e.modification_needed,
    ).length;

    const description = [
      `## Flowdown Matrix Review Required`,
      `**Contract:** ${contractId}`,
      `**Subcontractor:** ${sub.subcontractorName}`,
      `**Subcontract Value:** $${sub.ceilingValue.toLocaleString()}`,
      `**Business Size:** ${sub.businessSize ?? "Not specified"}`,
      "",
      `### Summary`,
      `- **Total Prime Clauses:** ${matrix.length}`,
      `- **Flowing Down:** ${flowdownCount}`,
      `- **Exempted/N/A:** ${exemptedCount}`,
      `- **Modified Language Drafted:** ${modifiedCount}`,
      "",
      `### Flowing Down`,
      ...matrix
        .filter((e) => e.flows_down)
        .map(
          (e) =>
            `- **${e.prime_clause}** ${e.clause_title} (${e.basis})`,
        ),
      "",
      `### Exempted / Not Applicable`,
      ...matrix
        .filter((e) => !e.flows_down)
        .map(
          (e) =>
            `- **${e.prime_clause}** ${e.clause_title} — ${e.basis}: ${e.notes}`,
        ),
    ].join("\n");

    return this.mcp.executeTool("jira.createIssue", {
      project: this.config.jiraProject,
      issueType: "Review",
      summary: `[FLOWDOWN] Review matrix — ${sub.subcontractorName} — Contract ${contractId}`,
      description,
      fields: {
        labels: ["flowdown-matrix", "review-required"],
        attachments: docResult.data.documentUrl
          ? [docResult.data.documentUrl]
          : [],
      },
    });
  }
}
