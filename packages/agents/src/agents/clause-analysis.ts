/**
 * Clause Analysis Agent
 *
 * Reviews contract clauses against Dynamo's playbook rules,
 * scores risk, generates redlines, finds precedents, and
 * creates reports via Jira and Teams notifications.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";
import {
  PlaybookEngine,
  type PlaybookRule,
  type RuleMatch,
  type ClauseInput,
  SAMPLE_PLAYBOOK_RULES,
} from "./helpers/playbook-engine.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ClauseAnalysisPayload {
  contractId: string;
  s3Key?: string;
  isModification?: boolean;
  clauseDiff?: {
    added: unknown[];
    removed: unknown[];
    modified: unknown[];
  };
}

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface LLMAnalysisResult {
  deviation_found: boolean;
  severity: RiskSeverity;
  explanation: string;
  recommended_redline: string | null;
}

export interface PrecedentCitation {
  contractId: string;
  clauseNumber: string;
  chunkText: string;
  similarityScore: number;
}

export interface ClauseRiskAssessment {
  clauseNumber: string;
  clauseTitle: string;
  clauseType: string;
  matchedRule: string;
  standardPosition: string;
  deviationFound: boolean;
  severity: RiskSeverity;
  explanation: string;
  recommendedRedline: string | null;
  precedents: PrecedentCitation[];
}

export interface ClauseAnalysisReport {
  contractId: string;
  overallRisk: RiskSeverity;
  totalClauses: number;
  analyzedClauses: number;
  riskBreakdown: Record<RiskSeverity, number>;
  assessments: ClauseRiskAssessment[];
  criticalFindings: ClauseRiskAssessment[];
}

export interface ClauseAnalysisConfig {
  jiraProject?: string;
  teamsChannelId?: string;
  maxPrecedents?: number;
}

// ─── LLM prompt ──────────────────────────────────────────────────────

function buildAnalysisPrompt(
  clause: ClauseInput,
  rule: PlaybookRule,
): string {
  return `You are a government contracts analyst reviewing clause language against Dynamo's standard playbook positions.

Analyze whether the clause deviates from Dynamo's standard position.

Clause under review:
- Number: ${clause.clauseNumber}
- Title: ${clause.clauseTitle}
- Type: ${clause.clauseType}

Dynamo's standard position:
${rule.actions.standard_position}

Default risk if deviated: ${rule.actions.risk_if_deviated}

Respond ONLY with valid JSON:
{
  "deviation_found": true/false,
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "explanation": "Plain-language explanation of the risk",
  "recommended_redline": "Specific redline text" or null if no deviation
}`;
}

// ─── LLM response parser ────────────────────────────────────────────

export function parseAnalysisResponse(
  raw: string,
  fallbackSeverity: RiskSeverity,
): LLMAnalysisResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  const validSeverities: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const severity = validSeverities.includes(parsed.severity)
    ? (parsed.severity as RiskSeverity)
    : fallbackSeverity;

  return {
    deviation_found: parsed.deviation_found === true,
    severity,
    explanation: parsed.explanation ?? "",
    recommended_redline: parsed.recommended_redline ?? null,
  };
}

// ─── Overall risk calculation ────────────────────────────────────────

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function computeOverallRisk(
  assessments: ClauseRiskAssessment[],
): RiskSeverity {
  if (assessments.length === 0) return "LOW";

  let highest: RiskSeverity = "LOW";
  for (const a of assessments) {
    if (a.deviationFound && SEVERITY_ORDER[a.severity] > SEVERITY_ORDER[highest]) {
      highest = a.severity;
    }
  }
  return highest;
}

// ─── Agent ───────────────────────────────────────────────────────────

export class ClauseAnalysisAgent extends BaseAgent {
  readonly name = "clause-analysis";
  readonly type = "analysis";
  readonly description =
    "Analyzes contract clauses against playbook rules, scores risk, generates redlines, and creates reports";

  private readonly mcp: ArcadeClient;
  private readonly engine: PlaybookEngine;
  private readonly config: Required<ClauseAnalysisConfig>;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      engine?: PlaybookEngine;
      config?: ClauseAnalysisConfig;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.engine = options?.engine ?? new PlaybookEngine();
    this.config = {
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId: options?.config?.teamsChannelId ?? "contracts-analysis",
      maxPrecedents: options?.config?.maxPrecedents ?? 3,
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload = task.triggerPayload as unknown as ClauseAnalysisPayload;
    const { contractId } = payload;

    // 1. Log start
    await this.createAuditEntry(task.id, "RUNNING", {
      input: { contractId },
    });

    // 2. Load contract clauses from DB
    const clauseRows = await this.queryDatabase(
      `SELECT clause_number, clause_title, clause_type
       FROM contracts.contract_clauses
       WHERE contract_id = $1`,
      [contractId],
    );

    const clauses: ClauseInput[] = clauseRows.map((r: any) => ({
      clauseNumber: r.clause_number,
      clauseTitle: r.clause_title,
      clauseType: r.clause_type,
    }));

    // 3. Load playbook rules
    const allRules = await this.loadPlaybookRules();

    // 4. Get contract context for filtering
    let contractType: string | undefined;
    let agency: string | undefined;
    try {
      const ctx = await this.getContractContext(contractId);
      contractType = ctx.contractType;
      agency = ctx.awardingAgency;
    } catch {
      // Context not available; use all rules
    }

    const applicableRules = this.engine.loadRules(allRules, contractType, agency);

    // 5. Analyze each clause
    const assessments: ClauseRiskAssessment[] = [];
    const riskBreakdown: Record<RiskSeverity, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };

    for (const clause of clauses) {
      const matches = this.engine.evaluateClause(clause, applicableRules);

      if (matches.length === 0) {
        // No matching rules — skip analysis
        continue;
      }

      // Use highest-priority matching rule
      const topMatch = matches[0]!;
      const assessment = await this.analyzeClause(clause, topMatch, contractId);
      assessments.push(assessment);

      if (assessment.deviationFound) {
        riskBreakdown[assessment.severity]++;
      }

      // 6. Update clause risk_category in DB
      await this.queryDatabase(
        `UPDATE contracts.contract_clauses
         SET risk_category = $1
         WHERE contract_id = $2 AND clause_number = $3`,
        [assessment.severity, contractId, clause.clauseNumber],
      );
    }

    // 7. Build report
    const overallRisk = computeOverallRisk(assessments);
    const criticalFindings = assessments.filter(
      (a) => a.deviationFound && a.severity === "CRITICAL",
    );

    const report: ClauseAnalysisReport = {
      contractId,
      overallRisk,
      totalClauses: clauses.length,
      analyzedClauses: assessments.length,
      riskBreakdown,
      assessments,
      criticalFindings,
    };

    // 8. Create/update Jira ticket with report
    const jiraResult = await this.createJiraReport(report);
    const jiraKey = jiraResult.data.issueKey as string;

    // 9. If any CRITICAL risks → Teams alert
    let teamsAlertSent = false;
    if (criticalFindings.length > 0) {
      await this.sendCriticalAlert(report, jiraKey);
      teamsAlertSent = true;
    }

    // 10. Log completion
    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { contractId },
      output: {
        overallRisk,
        totalClauses: clauses.length,
        analyzedClauses: assessments.length,
        criticalCount: criticalFindings.length,
        riskBreakdown,
        jiraKey,
        teamsAlertSent,
      },
    });

    return {
      success: true,
      data: {
        contractId,
        overallRisk,
        totalClauses: clauses.length,
        analyzedClauses: assessments.length,
        riskBreakdown: riskBreakdown as unknown as Record<string, unknown>,
        criticalCount: criticalFindings.length,
        assessments: assessments as unknown as Record<string, unknown>,
        jiraKey,
        teamsAlertSent,
      },
    };
  }

  // ─── Clause analysis ───────────────────────────────────────────────

  private async analyzeClause(
    clause: ClauseInput,
    match: RuleMatch,
    contractId: string,
  ): Promise<ClauseRiskAssessment> {
    // Call LLM for analysis
    const prompt = buildAnalysisPrompt(clause, match.rule);
    const llmRaw = await this.callLLM(prompt, {
      temperature: 0.1,
      maxTokens: 1024,
    });

    const analysis = parseAnalysisResponse(
      llmRaw,
      match.rule.actions.risk_if_deviated,
    );

    // Search for precedents via vector search
    const precedents = await this.findPrecedents(clause, contractId);

    // If deviation found and severity >= MEDIUM, use redline template if LLM didn't provide one
    let redline = analysis.recommended_redline;
    if (
      analysis.deviation_found &&
      !redline &&
      SEVERITY_ORDER[analysis.severity] >= SEVERITY_ORDER["MEDIUM"]
    ) {
      redline = match.rule.actions.redline_template ?? null;
    }

    return {
      clauseNumber: clause.clauseNumber,
      clauseTitle: clause.clauseTitle,
      clauseType: clause.clauseType,
      matchedRule: match.rule.ruleName,
      standardPosition: match.rule.actions.standard_position,
      deviationFound: analysis.deviation_found,
      severity: analysis.severity,
      explanation: analysis.explanation,
      recommendedRedline: redline,
      precedents,
    };
  }

  // ─── Precedent search ──────────────────────────────────────────────

  private async findPrecedents(
    clause: ClauseInput,
    excludeContractId: string,
  ): Promise<PrecedentCitation[]> {
    const results = await this.searchVectors(
      `${clause.clauseNumber} ${clause.clauseTitle}`,
      { limit: this.config.maxPrecedents + 2 },
    );

    return results
      .filter((r) => r.contractId !== excludeContractId)
      .slice(0, this.config.maxPrecedents)
      .map((r) => ({
        contractId: r.contractId,
        clauseNumber: r.clauseNumber ?? clause.clauseNumber,
        chunkText: r.chunkText,
        similarityScore: r.similarityScore,
      }));
  }

  // ─── Playbook rules loader ─────────────────────────────────────────

  private async loadPlaybookRules(): Promise<PlaybookRule[]> {
    const rows = await this.queryDatabase(
      `SELECT id, rule_name, rule_type, conditions_json, actions_json, priority, enabled
       FROM agents.playbook_rules
       WHERE rule_type = 'CLAUSE_RISK' AND enabled = true
       ORDER BY priority DESC`,
      [],
    );

    if (rows.length === 0) {
      // Fallback to sample rules if none in DB
      return SAMPLE_PLAYBOOK_RULES.map((r, i) => ({
        ...r,
        id: `sample-${i}`,
      }));
    }

    return rows.map((r: any) => ({
      id: r.id,
      ruleName: r.rule_name,
      ruleType: r.rule_type,
      conditions: r.conditions_json as any,
      actions: r.actions_json as any,
      priority: r.priority,
      enabled: r.enabled,
    }));
  }

  // ─── Jira report ───────────────────────────────────────────────────

  private async createJiraReport(report: ClauseAnalysisReport) {
    const riskEmoji =
      report.overallRisk === "CRITICAL" ? "🔴" :
      report.overallRisk === "HIGH" ? "🟠" :
      report.overallRisk === "MEDIUM" ? "🟡" : "🟢";

    const description = [
      `## Clause Analysis Report`,
      `**Contract:** ${report.contractId}`,
      `**Overall Risk:** ${riskEmoji} ${report.overallRisk}`,
      `**Clauses Analyzed:** ${report.analyzedClauses} of ${report.totalClauses}`,
      "",
      `### Risk Breakdown`,
      `- CRITICAL: ${report.riskBreakdown.CRITICAL}`,
      `- HIGH: ${report.riskBreakdown.HIGH}`,
      `- MEDIUM: ${report.riskBreakdown.MEDIUM}`,
      `- LOW: ${report.riskBreakdown.LOW}`,
    ];

    if (report.criticalFindings.length > 0) {
      description.push("", "### Critical Findings");
      for (const finding of report.criticalFindings) {
        description.push(
          `- **${finding.clauseNumber}** (${finding.clauseTitle}): ${finding.explanation}`,
        );
        if (finding.recommendedRedline) {
          description.push(`  - Recommended: ${finding.recommendedRedline}`);
        }
      }
    }

    if (report.assessments.length > 0) {
      description.push("", "### All Findings");
      for (const a of report.assessments) {
        if (a.deviationFound) {
          description.push(
            `- [${a.severity}] **${a.clauseNumber}**: ${a.explanation}`,
          );
        }
      }
    }

    return this.mcp.executeTool("jira.createIssue", {
      project: this.config.jiraProject,
      issueType: "Analysis Report",
      summary: `[CLAUSE-ANALYSIS] ${report.overallRisk} risk - Contract ${report.contractId}`,
      description: description.join("\n"),
      fields: {
        priority: { name: report.overallRisk === "CRITICAL" ? "URGENT" : report.overallRisk },
        labels: [
          "clause-analysis",
          `risk-${report.overallRisk.toLowerCase()}`,
        ],
      },
    });
  }

  // ─── Teams alert for CRITICAL ──────────────────────────────────────

  private async sendCriticalAlert(
    report: ClauseAnalysisReport,
    jiraKey: string,
  ) {
    const findings = report.criticalFindings
      .map((f) => `- **${f.clauseNumber}**: ${f.explanation}`)
      .join("\n");

    const message = [
      `🔴 **CRITICAL RISK ALERT** — Contract ${report.contractId}`,
      `**${report.criticalFindings.length} critical clause deviation(s) found**`,
      "",
      findings,
      "",
      `**Jira:** ${jiraKey}`,
      `**Action Required:** Contracts manager review before execution.`,
    ].join("\n");

    return this.mcp.executeTool("microsoft.teams.sendMessage", {
      channelId: this.config.teamsChannelId,
      message,
    });
  }
}
