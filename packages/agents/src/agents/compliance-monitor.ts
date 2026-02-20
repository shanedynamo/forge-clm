/**
 * Compliance Monitor Agent
 *
 * Monitors active contracts for upcoming deadlines, overdue items,
 * funding burn, option windows, and compliance obligations.
 * Runs daily on schedule and on contract state transitions.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";
import {
  FundingCalculator,
  type ContractFundingData,
  type FundingAnalysis,
  type FundingAlert,
} from "./helpers/funding-calculator.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ComplianceMonitorPayload {
  /** If set, only check this contract (event-triggered). Otherwise daily run. */
  contractId?: string;
  /** POP fields for compliance-monitor trigger from ingestion agent */
  popStart?: string;
  popEnd?: string;
}

export type FindingSeverity = "INFO" | "WARNING" | "URGENT" | "CRITICAL";

export interface ComplianceFinding {
  contractId: string;
  contractNumber: string;
  category: "DELIVERABLE" | "OPTION" | "FUNDING" | "MILESTONE" | "POP_EXPIRATION" | "PROPERTY";
  severity: FindingSeverity;
  title: string;
  description: string;
  dueDate?: string;
  daysRemaining?: number;
  itemId?: string;
  actionRequired: boolean;
}

export interface ComplianceSummary {
  totalContracts: number;
  totalFindings: number;
  criticalCount: number;
  urgentCount: number;
  warningCount: number;
  infoCount: number;
  findings: ComplianceFinding[];
  fundingAnalyses: FundingAnalysis[];
  jiraTicketsCreated: number;
  teamsNotificationsSent: number;
}

export interface ComplianceMonitorConfig {
  jiraProject?: string;
  teamsChannelId?: string;
  summaryEmailTo?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(dateStr: string, now: Date): number {
  return Math.ceil((new Date(dateStr).getTime() - now.getTime()) / MS_PER_DAY);
}

function severityFromDays(
  days: number,
  thresholds: { info: number; warning: number; urgent: number },
): FindingSeverity {
  if (days < 0) return "CRITICAL";
  if (days <= thresholds.urgent) return "URGENT";
  if (days <= thresholds.warning) return "WARNING";
  if (days <= thresholds.info) return "INFO";
  return "INFO";
}

// ─── Agent ───────────────────────────────────────────────────────────

export class ComplianceMonitorAgent extends BaseAgent {
  readonly name = "compliance-monitor";
  readonly type = "compliance";
  readonly description =
    "Monitors active contracts for deadlines, overdue items, funding burn, option windows, and compliance obligations";

  private readonly mcp: ArcadeClient;
  private readonly fundingCalc: FundingCalculator;
  private readonly config: Required<ComplianceMonitorConfig>;
  private readonly now: Date;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      config?: ComplianceMonitorConfig;
      now?: Date;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.now = options?.now ?? new Date();
    this.fundingCalc = new FundingCalculator(this.now);
    this.config = {
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId: options?.config?.teamsChannelId ?? "contracts-compliance",
      summaryEmailTo: options?.config?.summaryEmailTo ?? "contracts-team@forge.gov",
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload = task.triggerPayload as unknown as ComplianceMonitorPayload;

    await this.createAuditEntry(task.id, "RUNNING", {
      input: { contractId: payload.contractId ?? "all", triggerType: task.triggerType },
    });

    // Load contracts to check
    const contracts = payload.contractId
      ? await this.loadContract(payload.contractId)
      : await this.loadActiveContracts();

    const findings: ComplianceFinding[] = [];
    const fundingAnalyses: FundingAnalysis[] = [];
    let jiraTicketsCreated = 0;
    let teamsNotificationsSent = 0;

    for (const contract of contracts) {
      // a. Deliverable deadlines
      const deliverableFindings = await this.checkDeliverables(contract);
      findings.push(...deliverableFindings);

      // b. Option exercise windows
      const optionFindings = await this.checkOptions(contract);
      findings.push(...optionFindings);

      // c. Funding burn rate
      const fundingData: ContractFundingData = {
        contractId: contract.id,
        contractNumber: contract.contract_number,
        ceilingValue: parseFloat(contract.ceiling_value),
        fundedValue: parseFloat(contract.funded_value),
        popStart: contract.pop_start,
        popEnd: contract.pop_end,
      };
      const fundingAnalysis = this.fundingCalc.calculateBurnRate(fundingData);
      fundingAnalyses.push(fundingAnalysis);

      for (const alert of fundingAnalysis.alerts) {
        findings.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          category: "FUNDING",
          severity: alert.severity as FindingSeverity,
          title: `Funding Alert: ${contract.contract_number}`,
          description: alert.message,
          actionRequired: alert.severity === "CRITICAL" || alert.severity === "URGENT",
        });
      }

      // d. Compliance milestones
      const milestoneFindings = await this.checkMilestones(contract);
      findings.push(...milestoneFindings);

      // e. Contract expiration (POP end)
      const popFindings = this.checkPopExpiration(contract);
      findings.push(...popFindings);

      // f. Government property
      const propertyFindings = await this.checkProperty(contract);
      findings.push(...propertyFindings);
    }

    // Create Jira tickets for actionable findings
    for (const finding of findings) {
      if (finding.actionRequired) {
        const created = await this.createJiraTicketIfNew(finding);
        if (created) jiraTicketsCreated++;
      }
    }

    // Send Teams notifications for urgent/critical
    const urgentFindings = findings.filter(
      (f) => f.severity === "URGENT" || f.severity === "CRITICAL",
    );
    if (urgentFindings.length > 0) {
      await this.sendTeamsNotifications(urgentFindings);
      teamsNotificationsSent = urgentFindings.length;
    }

    // Generate weekly summary if this is a scheduled run
    if (task.triggerType === "SCHEDULE" && !payload.contractId) {
      await this.sendWeeklySummary(findings, fundingAnalyses);
    }

    const summary: ComplianceSummary = {
      totalContracts: contracts.length,
      totalFindings: findings.length,
      criticalCount: findings.filter((f) => f.severity === "CRITICAL").length,
      urgentCount: findings.filter((f) => f.severity === "URGENT").length,
      warningCount: findings.filter((f) => f.severity === "WARNING").length,
      infoCount: findings.filter((f) => f.severity === "INFO").length,
      findings,
      fundingAnalyses,
      jiraTicketsCreated,
      teamsNotificationsSent,
    };

    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { contractId: payload.contractId ?? "all" },
      output: {
        totalContracts: summary.totalContracts,
        totalFindings: summary.totalFindings,
        criticalCount: summary.criticalCount,
        urgentCount: summary.urgentCount,
        jiraTicketsCreated,
        teamsNotificationsSent,
      },
    });

    return {
      success: true,
      data: {
        totalContracts: summary.totalContracts,
        totalFindings: summary.totalFindings,
        criticalCount: summary.criticalCount,
        urgentCount: summary.urgentCount,
        warningCount: summary.warningCount,
        infoCount: summary.infoCount,
        jiraTicketsCreated,
        teamsNotificationsSent,
        findings: findings as unknown as Record<string, unknown>,
        fundingAnalyses: fundingAnalyses as unknown as Record<string, unknown>,
      },
    };
  }

  // ─── Contract loading ──────────────────────────────────────────────

  private async loadActiveContracts(): Promise<any[]> {
    return this.queryDatabase(
      `SELECT id, contract_number, contract_type, awarding_agency,
              contracting_officer_name, contracting_officer_email,
              pop_start, pop_end, ceiling_value, funded_value, status
       FROM contracts.contracts
       WHERE status = 'ACTIVE'
       ORDER BY pop_end ASC`,
      [],
    );
  }

  private async loadContract(contractId: string): Promise<any[]> {
    return this.queryDatabase(
      `SELECT id, contract_number, contract_type, awarding_agency,
              contracting_officer_name, contracting_officer_email,
              pop_start, pop_end, ceiling_value, funded_value, status
       FROM contracts.contracts
       WHERE id = $1`,
      [contractId],
    );
  }

  // ─── a. Deliverable deadlines ──────────────────────────────────────

  private async checkDeliverables(contract: any): Promise<ComplianceFinding[]> {
    const rows = await this.queryDatabase(
      `SELECT id, deliverable_type, description, due_date, status
       FROM contracts.deliverables
       WHERE contract_id = $1
         AND status NOT IN ('ACCEPTED', 'SUBMITTED')
         AND due_date IS NOT NULL
       ORDER BY due_date ASC`,
      [contract.id],
    );

    const findings: ComplianceFinding[] = [];

    for (const row of rows as any[]) {
      const days = daysUntil(row.due_date, this.now);

      if (days > 30) continue;

      const isOverdue = days < 0;
      const severity = severityFromDays(days, { info: 30, warning: 14, urgent: 7 });

      // Update status to OVERDUE if past due
      if (isOverdue && row.status !== "OVERDUE") {
        await this.queryDatabase(
          `UPDATE contracts.deliverables SET status = 'OVERDUE' WHERE id = $1`,
          [row.id],
        );
      }

      findings.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        category: "DELIVERABLE",
        severity,
        title: `${isOverdue ? "OVERDUE" : "Upcoming"} Deliverable: ${row.deliverable_type}`,
        description: row.description ?? row.deliverable_type,
        dueDate: row.due_date,
        daysRemaining: days,
        itemId: row.id,
        actionRequired: severity === "URGENT" || severity === "CRITICAL",
      });
    }

    return findings;
  }

  // ─── b. Option exercise windows ────────────────────────────────────

  private async checkOptions(contract: any): Promise<ComplianceFinding[]> {
    const rows = await this.queryDatabase(
      `SELECT id, option_number, option_start, option_end, option_value,
              exercise_deadline, status
       FROM contracts.contract_options
       WHERE contract_id = $1
         AND status NOT IN ('EXERCISED')
       ORDER BY exercise_deadline ASC`,
      [contract.id],
    );

    const findings: ComplianceFinding[] = [];

    for (const row of rows as any[]) {
      const days = daysUntil(row.exercise_deadline, this.now);

      // Expired option
      if (days < 0 && row.status !== "EXPIRED") {
        await this.queryDatabase(
          `UPDATE contracts.contract_options SET status = 'EXPIRED' WHERE id = $1`,
          [row.id],
        );
        await this.transitionState("PRIME_CONTRACT", contract.id, "OPTION_EXPIRED").catch(() => {});

        findings.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          category: "OPTION",
          severity: "CRITICAL",
          title: `Option ${row.option_number} EXPIRED`,
          description: `Option ${row.option_number} exercise deadline passed (${row.exercise_deadline}). Value: $${row.option_value}`,
          dueDate: row.exercise_deadline,
          daysRemaining: days,
          itemId: row.id,
          actionRequired: true,
        });
        continue;
      }

      // Approaching options (90, 60, 30 day windows)
      if (days <= 90) {
        const severity = severityFromDays(days, { info: 90, warning: 60, urgent: 30 });

        findings.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          category: "OPTION",
          severity,
          title: `Option ${row.option_number} exercise deadline in ${days} days`,
          description: `Option ${row.option_number} for ${contract.contract_number}: exercise by ${row.exercise_deadline}. Value: $${row.option_value}`,
          dueDate: row.exercise_deadline,
          daysRemaining: days,
          itemId: row.id,
          actionRequired: severity === "URGENT" || severity === "CRITICAL",
        });
      }
    }

    return findings;
  }

  // ─── d. Compliance milestones ──────────────────────────────────────

  private async checkMilestones(contract: any): Promise<ComplianceFinding[]> {
    const rows = await this.queryDatabase(
      `SELECT id, milestone_type, description, due_date, responsible_party, status
       FROM contracts.compliance_milestones
       WHERE contract_id = $1
         AND status NOT IN ('COMPLETED', 'WAIVED')
       ORDER BY due_date ASC`,
      [contract.id],
    );

    const findings: ComplianceFinding[] = [];

    for (const row of rows as any[]) {
      const days = daysUntil(row.due_date, this.now);

      if (days > 30) continue;

      const isOverdue = days < 0;
      const severity = severityFromDays(days, { info: 30, warning: 14, urgent: 7 });

      if (isOverdue && row.status !== "OVERDUE") {
        await this.queryDatabase(
          `UPDATE contracts.compliance_milestones SET status = 'OVERDUE' WHERE id = $1`,
          [row.id],
        );
      }

      findings.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        category: "MILESTONE",
        severity,
        title: `${isOverdue ? "OVERDUE" : "Upcoming"} Milestone: ${row.milestone_type}`,
        description: `${row.description ?? row.milestone_type} (Responsible: ${row.responsible_party})`,
        dueDate: row.due_date,
        daysRemaining: days,
        itemId: row.id,
        actionRequired: severity === "URGENT" || severity === "CRITICAL",
      });
    }

    return findings;
  }

  // ─── e. POP expiration ─────────────────────────────────────────────

  private checkPopExpiration(contract: any): ComplianceFinding[] {
    const days = daysUntil(contract.pop_end, this.now);

    if (days > 90 || days < 0) return [];

    const severity = severityFromDays(days, { info: 90, warning: 60, urgent: 30 });

    return [
      {
        contractId: contract.id,
        contractNumber: contract.contract_number,
        category: "POP_EXPIRATION",
        severity,
        title: `Contract ${contract.contract_number} POP ends in ${days} days`,
        description: `Period of performance ends ${contract.pop_end}. Plan closeout activities.`,
        dueDate: contract.pop_end,
        daysRemaining: days,
        actionRequired: severity === "URGENT" || severity === "CRITICAL",
      },
    ];
  }

  // ─── f. Government property ────────────────────────────────────────

  private async checkProperty(contract: any): Promise<ComplianceFinding[]> {
    const rows = await this.queryDatabase(
      `SELECT id, property_type, description, inventory_due_date, custodian, status
       FROM contracts.government_property
       WHERE contract_id = $1
         AND status = 'ACTIVE'
         AND inventory_due_date IS NOT NULL
       ORDER BY inventory_due_date ASC`,
      [contract.id],
    );

    const findings: ComplianceFinding[] = [];

    for (const row of rows as any[]) {
      const days = daysUntil(row.inventory_due_date, this.now);

      if (days > 60) continue;

      const severity = severityFromDays(days, { info: 60, warning: 30, urgent: 14 });

      findings.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        category: "PROPERTY",
        severity,
        title: `${days < 0 ? "OVERDUE" : "Upcoming"} Inventory: ${row.property_type}`,
        description: `${row.description} - Custodian: ${row.custodian}. Inventory due: ${row.inventory_due_date}`,
        dueDate: row.inventory_due_date,
        daysRemaining: days,
        itemId: row.id,
        actionRequired: severity === "URGENT" || severity === "CRITICAL",
      });
    }

    return findings;
  }

  // ─── Jira ticket creation (dedup) ──────────────────────────────────

  private async createJiraTicketIfNew(finding: ComplianceFinding): Promise<boolean> {
    // Check for existing open Jira ticket for this item
    if (finding.itemId) {
      const existing = await this.queryDatabase(
        `SELECT id FROM contracts.contract_requests
         WHERE jira_ticket_id IS NOT NULL
           AND status = 'OPEN'
           AND details_json->>'itemId' = $1`,
        [finding.itemId],
      );
      if ((existing as any[]).length > 0) return false;
    }

    await this.mcp.executeTool("jira.createIssue", {
      project: this.config.jiraProject,
      issueType: "Compliance",
      summary: `[${finding.severity}] ${finding.title}`,
      description: [
        `**Contract:** ${finding.contractNumber}`,
        `**Category:** ${finding.category}`,
        `**Due:** ${finding.dueDate ?? "N/A"}`,
        `**Days Remaining:** ${finding.daysRemaining ?? "N/A"}`,
        "",
        finding.description,
      ].join("\n"),
      fields: {
        priority: { name: finding.severity === "CRITICAL" ? "URGENT" : finding.severity },
        labels: ["compliance", finding.category.toLowerCase()],
      },
    });

    return true;
  }

  // ─── Teams notifications ───────────────────────────────────────────

  private async sendTeamsNotifications(findings: ComplianceFinding[]): Promise<void> {
    const lines = findings.map((f) => {
      const emoji = f.severity === "CRITICAL" ? "🔴" : "🟠";
      return `${emoji} **[${f.severity}]** ${f.title} — ${f.contractNumber}${f.daysRemaining !== undefined ? ` (${f.daysRemaining}d)` : ""}`;
    });

    const message = [
      `⚠️ **Compliance Monitor: ${findings.length} urgent/critical finding(s)**`,
      "",
      ...lines,
    ].join("\n");

    await this.mcp.executeTool("microsoft.teams.sendMessage", {
      channelId: this.config.teamsChannelId,
      message,
    });
  }

  // ─── Weekly summary email ──────────────────────────────────────────

  private async sendWeeklySummary(
    findings: ComplianceFinding[],
    fundingAnalyses: FundingAnalysis[],
  ): Promise<void> {
    const upcoming = findings.filter((f) => (f.daysRemaining ?? 0) >= 0);
    const overdue = findings.filter((f) => (f.daysRemaining ?? 0) < 0);
    const fundingAlerts = fundingAnalyses.filter((a) => a.alerts.length > 0);

    const body = [
      "Weekly Compliance Summary",
      "=========================",
      "",
      `Total Findings: ${findings.length}`,
      `Critical: ${findings.filter((f) => f.severity === "CRITICAL").length}`,
      `Urgent: ${findings.filter((f) => f.severity === "URGENT").length}`,
      "",
      "--- OVERDUE ITEMS ---",
      ...overdue.map(
        (f) => `- [${f.category}] ${f.contractNumber}: ${f.title}`,
      ),
      overdue.length === 0 ? "None" : "",
      "",
      "--- UPCOMING (30 days) ---",
      ...upcoming
        .filter((f) => (f.daysRemaining ?? 0) <= 30)
        .map(
          (f) => `- [${f.category}] ${f.contractNumber}: ${f.title} (${f.daysRemaining}d)`,
        ),
      "",
      "--- FUNDING STATUS ---",
      ...fundingAlerts.map(
        (a) => `- ${a.contractNumber}: ${a.alerts.map((al) => al.message).join("; ")}`,
      ),
      fundingAlerts.length === 0 ? "All contracts within normal funding parameters." : "",
    ].join("\n");

    await this.mcp.executeTool("microsoft.outlook.sendEmail", {
      to: this.config.summaryEmailTo,
      subject: `Weekly Compliance Summary — ${this.now.toISOString().split("T")[0]}`,
      body,
    });
  }
}
