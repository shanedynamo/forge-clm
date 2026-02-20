/**
 * FundingCalculator — analyzes contract funding burn rate and projections.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ContractFundingData {
  contractId: string;
  contractNumber: string;
  ceilingValue: number;
  fundedValue: number;
  popStart: string; // ISO date
  popEnd: string;   // ISO date
}

export interface FundingAnalysis {
  contractId: string;
  contractNumber: string;
  fundingRatio: number;         // fundedValue / ceilingValue
  timeRatio: number;            // days elapsed / total POP days
  ceilingRemaining: number;     // ceilingValue - fundedValue
  estimatedMonthlyBurn: number;
  projectedRunoutDate: Date | null;
  alerts: FundingAlert[];
}

export interface FundingAlert {
  type: "HIGH_FUNDING" | "BURN_RATE_ANOMALY" | "CEILING_WARNING";
  severity: "INFO" | "WARNING" | "URGENT" | "CRITICAL";
  message: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;

// ─── FundingCalculator ───────────────────────────────────────────────

export class FundingCalculator {
  private readonly now: Date;

  constructor(now?: Date) {
    this.now = now ?? new Date();
  }

  /**
   * Full funding analysis for a contract.
   */
  calculateBurnRate(contract: ContractFundingData): FundingAnalysis {
    const popStartDate = new Date(contract.popStart);
    const popEndDate = new Date(contract.popEnd);

    const totalPopDays = Math.max(1, (popEndDate.getTime() - popStartDate.getTime()) / MS_PER_DAY);
    const daysElapsed = Math.max(0, (this.now.getTime() - popStartDate.getTime()) / MS_PER_DAY);

    const fundingRatio = contract.ceilingValue > 0
      ? contract.fundedValue / contract.ceilingValue
      : 0;
    const timeRatio = Math.min(1, daysElapsed / totalPopDays);
    const ceilingRemaining = contract.ceilingValue - contract.fundedValue;
    const estimatedMonthlyBurn = this.estimateMonthlyBurn(contract);
    const projectedRunoutDate = this.projectRunoutDate(contract);

    const alerts: FundingAlert[] = [];

    // High funding alert (>= 80%)
    if (fundingRatio >= 0.8) {
      alerts.push({
        type: "HIGH_FUNDING",
        severity: fundingRatio >= 0.95 ? "CRITICAL" : "WARNING",
        message: `Funding at ${(fundingRatio * 100).toFixed(0)}% of ceiling ($${contract.fundedValue.toLocaleString()} of $${contract.ceilingValue.toLocaleString()})`,
      });
    }

    // Burn rate anomaly (burning faster than time elapsed)
    if (timeRatio > 0.05 && fundingRatio > timeRatio + 0.2) {
      alerts.push({
        type: "BURN_RATE_ANOMALY",
        severity: fundingRatio > timeRatio + 0.4 ? "CRITICAL" : "WARNING",
        message: `Burn rate anomaly: ${(fundingRatio * 100).toFixed(0)}% funding used with only ${(timeRatio * 100).toFixed(0)}% of POP elapsed`,
      });
    }

    // Ceiling remaining less than 3 months of estimated burn
    if (estimatedMonthlyBurn > 0 && ceilingRemaining < estimatedMonthlyBurn * 3) {
      const monthsRemaining = ceilingRemaining / estimatedMonthlyBurn;
      alerts.push({
        type: "CEILING_WARNING",
        severity: monthsRemaining < 1 ? "CRITICAL" : "URGENT",
        message: `Only ${monthsRemaining.toFixed(1)} months of funding remaining at current burn rate ($${estimatedMonthlyBurn.toLocaleString()}/mo)`,
      });
    }

    return {
      contractId: contract.contractId,
      contractNumber: contract.contractNumber,
      fundingRatio,
      timeRatio,
      ceilingRemaining,
      estimatedMonthlyBurn,
      projectedRunoutDate,
      alerts,
    };
  }

  /**
   * Estimate monthly burn rate based on funded value and POP elapsed.
   */
  estimateMonthlyBurn(contract: ContractFundingData): number {
    const popStartDate = new Date(contract.popStart);
    const daysElapsed = Math.max(1, (this.now.getTime() - popStartDate.getTime()) / MS_PER_DAY);
    const monthsElapsed = daysElapsed / DAYS_PER_MONTH;

    return monthsElapsed > 0 ? contract.fundedValue / monthsElapsed : 0;
  }

  /**
   * Project the date when funding will run out at the current burn rate.
   */
  projectRunoutDate(contract: ContractFundingData): Date | null {
    const monthlyBurn = this.estimateMonthlyBurn(contract);
    if (monthlyBurn <= 0) return null;

    const ceilingRemaining = contract.ceilingValue - contract.fundedValue;
    if (ceilingRemaining <= 0) return this.now;

    const monthsRemaining = ceilingRemaining / monthlyBurn;
    const daysRemaining = monthsRemaining * DAYS_PER_MONTH;

    return new Date(this.now.getTime() + daysRemaining * MS_PER_DAY);
  }
}
