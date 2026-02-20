/**
 * PlaybookEngine — loads and evaluates playbook rules against contract clauses.
 *
 * Rules are stored in agents.playbook_rules with:
 *   conditionsJson: { clause_patterns, contract_types, agencies }
 *   actionsJson:    { standard_position, risk_if_deviated, redline_template }
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface PlaybookRuleConditions {
  /** Glob-like clause patterns, e.g. ["52.227-*", "252.227-*"] */
  clause_patterns?: string[];
  /** Contract types this rule applies to, e.g. ["CPFF", "T_AND_M"] */
  contract_types?: string[];
  /** Agencies, e.g. ["USAF", "US Army"] */
  agencies?: string[];
}

export interface PlaybookRuleActions {
  /** Dynamo's standard position for this clause area */
  standard_position: string;
  /** Risk level if clause deviates from standard position */
  risk_if_deviated: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Template for a recommended redline */
  redline_template?: string;
}

export interface PlaybookRule {
  id: string;
  ruleName: string;
  ruleType: string;
  conditions: PlaybookRuleConditions;
  actions: PlaybookRuleActions;
  priority: number;
  enabled: boolean;
}

export interface ClauseInput {
  clauseNumber: string;
  clauseTitle: string;
  clauseType: "FAR" | "DFARS" | "AGENCY_SUPPLEMENT";
}

export interface RuleMatch {
  rule: PlaybookRule;
  clause: ClauseInput;
  matchedPattern: string;
}

// ─── Pattern matching ────────────────────────────────────────────────

/**
 * Match a clause number against a pattern with wildcard support.
 * "52.227-*" matches "52.227-14", "52.227-7014", etc.
 */
function matchesPattern(clauseNumber: string, pattern: string): boolean {
  // Escape regex special chars except *, then convert * to .*
  const regex = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return regex.test(clauseNumber);
}

// ─── PlaybookEngine ──────────────────────────────────────────────────

export class PlaybookEngine {
  /**
   * Load playbook rules applicable to a given contract type and agency.
   * Filters by CLAUSE_RISK rule type, enabled status, and optional contract_types/agencies.
   */
  loadRules(
    allRules: PlaybookRule[],
    contractType?: string,
    agency?: string,
  ): PlaybookRule[] {
    return allRules
      .filter((rule) => {
        if (!rule.enabled) return false;
        if (rule.ruleType !== "CLAUSE_RISK") return false;

        // If rule specifies contract_types, check membership
        if (
          contractType &&
          rule.conditions.contract_types &&
          rule.conditions.contract_types.length > 0
        ) {
          if (!rule.conditions.contract_types.includes(contractType)) return false;
        }

        // If rule specifies agencies, check membership
        if (
          agency &&
          rule.conditions.agencies &&
          rule.conditions.agencies.length > 0
        ) {
          if (!rule.conditions.agencies.includes(agency)) return false;
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Evaluate a clause against a set of rules.
   * Returns all matching rules in priority order.
   */
  evaluateClause(clause: ClauseInput, rules: PlaybookRule[]): RuleMatch[] {
    const matches: RuleMatch[] = [];

    for (const rule of rules) {
      const patterns = rule.conditions.clause_patterns ?? [];
      for (const pattern of patterns) {
        if (matchesPattern(clause.clauseNumber, pattern)) {
          matches.push({ rule, clause, matchedPattern: pattern });
          break; // One match per rule is enough
        }
      }
    }

    return matches.sort((a, b) => b.rule.priority - a.rule.priority);
  }
}

// ─── Sample playbook rules (15 rules) ───────────────────────────────

export const SAMPLE_PLAYBOOK_RULES: Omit<PlaybookRule, "id">[] = [
  // 1. IP/Data Rights - Unlimited Rights
  {
    ruleName: "IP Rights - Unlimited Rights Position",
    ruleType: "CLAUSE_RISK",
    conditions: {
      clause_patterns: ["52.227-14*"],
      contract_types: ["CPFF", "T_AND_M", "CPAF"],
    },
    actions: {
      standard_position:
        "Dynamo requires Government Purpose Rights (GPR) for all technical data developed under contract. Unlimited rights should be limited to data developed at private expense only.",
      risk_if_deviated: "CRITICAL",
      redline_template:
        "Replace 'unlimited rights' with 'Government Purpose Rights (GPR)' for all technical data and computer software developed under this contract.",
    },
    priority: 100,
    enabled: true,
  },
  // 2. IP/Data Rights - Technical Data
  {
    ruleName: "Technical Data Rights - DFARS",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["252.227-7013*", "252.227-7014*"] },
    actions: {
      standard_position:
        "Dynamo's standard is to negotiate GPR with a 5-year restriction period. Unlimited rights only for items listed in the contract as developed entirely at private expense.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Ensure GPR assertion is included for all deliverable technical data with a 5-year restriction period.",
    },
    priority: 95,
    enabled: true,
  },
  // 3. IP/Data Rights - Computer Software
  {
    ruleName: "Computer Software Rights",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["252.227-7015*", "252.227-7017*"] },
    actions: {
      standard_position:
        "Dynamo retains all IP rights to pre-existing software. New software developed under the contract should carry GPR.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Add GPR designation for newly developed software; mark all pre-existing software as restricted rights.",
    },
    priority: 90,
    enabled: true,
  },
  // 4. Limitation of Liability
  {
    ruleName: "Limitation of Liability",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.246-23*", "52.246-24*", "52.246-25*"] },
    actions: {
      standard_position:
        "Dynamo's standard liability cap is the total contract value. Unlimited liability clauses require CEO approval.",
      risk_if_deviated: "CRITICAL",
      redline_template:
        "Add limitation of liability clause: 'Contractor's total liability shall not exceed the total value of the contract.'",
    },
    priority: 98,
    enabled: true,
  },
  // 5. Indemnification
  {
    ruleName: "Indemnification Clause Review",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.228-7*", "52.250-*"] },
    actions: {
      standard_position:
        "Dynamo does not accept mutual indemnification without approval. Government indemnification for nuclear/bioweapons work requires board review.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Limit indemnification to contractor negligence and willful misconduct; exclude consequential damages.",
    },
    priority: 85,
    enabled: true,
  },
  // 6. Termination for Convenience
  {
    ruleName: "Termination for Convenience Terms",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.249-1*", "52.249-2*", "52.249-6*"] },
    actions: {
      standard_position:
        "Dynamo requires minimum 30-day notice for T4C. Settlement must include all costs incurred plus reasonable profit on work performed.",
      risk_if_deviated: "MEDIUM",
      redline_template:
        "Ensure 30-day minimum notice period and include profit allowance on completed work in settlement terms.",
    },
    priority: 70,
    enabled: true,
  },
  // 7. Key Personnel
  {
    ruleName: "Key Personnel Requirements",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.237-*", "H.KEY*"] },
    actions: {
      standard_position:
        "Dynamo accepts key personnel clauses with 30-day replacement window. Consent requirements for replacement must allow for reasonable substitution.",
      risk_if_deviated: "MEDIUM",
      redline_template:
        "Add 30-day replacement window and specify that replacement personnel must meet the same qualification requirements.",
    },
    priority: 60,
    enabled: true,
  },
  // 8. Government Property
  {
    ruleName: "Government Property Accountability",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.245-1*", "52.245-2*", "52.245-9*"] },
    actions: {
      standard_position:
        "Dynamo follows strict GFP accountability with annual inventories. Any deviations from FAR 52.245-1 require property management office review.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Ensure standard FAR 52.245-1 accountability requirements are included without deviation.",
    },
    priority: 75,
    enabled: true,
  },
  // 9. Small Business Subcontracting
  {
    ruleName: "Small Business Subcontracting Plan",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.219-8*", "52.219-9*"] },
    actions: {
      standard_position:
        "Dynamo commits to meeting small business goals. Subcontracting plans must be reviewed by SB office before submission.",
      risk_if_deviated: "MEDIUM",
      redline_template:
        "Align subcontracting goals with Dynamo's corporate small business objectives and ensure compliance with reporting requirements.",
    },
    priority: 65,
    enabled: true,
  },
  // 10. Cybersecurity - DFARS 7012
  {
    ruleName: "Cybersecurity DFARS 252.204-7012",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["252.204-7012*"] },
    actions: {
      standard_position:
        "Dynamo maintains CMMC Level 2 certification. CUI handling must align with NIST SP 800-171. Cyber incident reporting within 72 hours.",
      risk_if_deviated: "CRITICAL",
      redline_template:
        "Verify CUI markings and handling procedures align with NIST SP 800-171 Rev 2. Confirm 72-hour incident reporting timeline.",
    },
    priority: 99,
    enabled: true,
  },
  // 11. Export Control - ITAR
  {
    ruleName: "Export Control - ITAR Compliance",
    ruleType: "CLAUSE_RISK",
    conditions: {
      clause_patterns: ["252.225-7048*", "252.225-7043*", "DFARS.225*"],
    },
    actions: {
      standard_position:
        "Dynamo's export control officer must review all ITAR-controlled deliverables. TAAs and MLAs must be in place before performance.",
      risk_if_deviated: "CRITICAL",
      redline_template:
        "Ensure ITAR compliance plan is referenced and export-controlled data handling procedures are specified.",
    },
    priority: 97,
    enabled: true,
  },
  // 12. Export Control - EAR
  {
    ruleName: "Export Control - EAR Compliance",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.225-13*", "52.225-1*"] },
    actions: {
      standard_position:
        "EAR-controlled items require proper ECCN classification and Commerce Department licensing. Dynamo's trade compliance team must pre-approve.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Add ECCN classification requirement for all deliverable items subject to EAR.",
    },
    priority: 80,
    enabled: true,
  },
  // 13. Organizational Conflicts of Interest
  {
    ruleName: "Organizational Conflicts of Interest",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.209-8*", "52.209-9*", "H.OCI*"] },
    actions: {
      standard_position:
        "Dynamo requires OCI mitigation plans to be reviewed by legal before contract execution. Unequal access to information must be addressed.",
      risk_if_deviated: "HIGH",
      redline_template:
        "Ensure OCI mitigation plan is referenced and firewalling procedures are documented.",
    },
    priority: 82,
    enabled: true,
  },
  // 14. Cost Accounting Standards
  {
    ruleName: "Cost Accounting Standards Compliance",
    ruleType: "CLAUSE_RISK",
    conditions: {
      clause_patterns: ["52.230-2*", "52.230-3*", "52.230-6*"],
      contract_types: ["CPFF", "CPAF", "T_AND_M"],
    },
    actions: {
      standard_position:
        "Dynamo maintains full CAS compliance with approved disclosure statement. Any CAS-covered contract modifications require finance review.",
      risk_if_deviated: "MEDIUM",
      redline_template:
        "Reference Dynamo's current CAS Disclosure Statement and ensure cost accounting practices align.",
    },
    priority: 72,
    enabled: true,
  },
  // 15. Insurance Requirements
  {
    ruleName: "Insurance Requirements Review",
    ruleType: "CLAUSE_RISK",
    conditions: { clause_patterns: ["52.228-5*", "52.228-7*"] },
    actions: {
      standard_position:
        "Dynamo carries standard insurance coverage. Unusual insurance requirements (e.g., war risk, professional liability above $10M) require risk management approval.",
      risk_if_deviated: "LOW",
      redline_template:
        "Verify insurance requirements align with Dynamo's standard coverage. Flag any requirements exceeding $10M professional liability.",
    },
    priority: 50,
    enabled: true,
  },
];
