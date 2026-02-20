/**
 * Shared formatting utilities for display.
 */

export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function daysUntil(iso: string): number {
  const target = new Date(iso);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Status color map ────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  OPPORTUNITY_IDENTIFIED: "bg-gray-100 text-gray-700",
  PROPOSAL_IN_PROGRESS: "bg-blue-100 text-blue-700",
  PROPOSAL_SUBMITTED: "bg-indigo-100 text-indigo-700",
  AWARD_PENDING: "bg-purple-100 text-purple-700",
  AWARDED: "bg-green-100 text-green-700",
  ACTIVE: "bg-green-100 text-green-700",
  OPTION_PENDING: "bg-amber-100 text-amber-700",
  MOD_IN_PROGRESS: "bg-amber-100 text-amber-700",
  STOP_WORK: "bg-red-100 text-red-700",
  CLOSEOUT_PENDING: "bg-orange-100 text-orange-700",
  CLOSED: "bg-gray-200 text-gray-600",
  TERMINATED: "bg-red-200 text-red-700",
  NOT_AWARDED: "bg-gray-200 text-gray-500",
  // Modification states
  MOD_IDENTIFIED: "bg-gray-100 text-gray-700",
  MOD_ANALYSIS: "bg-blue-100 text-blue-700",
  MOD_DRAFTED: "bg-indigo-100 text-indigo-700",
  MOD_UNDER_REVIEW: "bg-amber-100 text-amber-700",
  MOD_SUBMITTED: "bg-purple-100 text-purple-700",
  MOD_NEGOTIATION: "bg-orange-100 text-orange-700",
  MOD_EXECUTED: "bg-green-100 text-green-700",
  MOD_WITHDRAWN: "bg-gray-200 text-gray-500",
  // Generic
  PENDING: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-green-100 text-green-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  OVERDUE: "bg-red-100 text-red-700",
  ACCEPTED: "bg-green-100 text-green-700",
  WAIVED: "bg-gray-200 text-gray-500",
  EXERCISED: "bg-green-100 text-green-700",
  NOT_EXERCISED: "bg-gray-100 text-gray-700",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// ─── Risk category colors ────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  LOW: "bg-green-100 text-green-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};

export function riskColor(risk: string | null): string {
  return RISK_COLORS[risk ?? ""] ?? "bg-gray-100 text-gray-600";
}
