export type AuthRole = "admin" | "contracts_manager" | "contracts_team" | "viewer";

export interface User {
  userId: string;
  email: string;
  name: string;
  role: AuthRole;
}

export interface ContractSummary {
  id: string;
  contractNumber: string;
  status: string;
  contractType: string;
  ceilingValue: string;
  fundedValue: string;
  awardingAgency: string;
  popStart: string;
  popEnd: string;
}

export interface DashboardMetrics {
  activeContracts: number;
  totalCeiling: number;
  totalFunded: number;
  pendingActions: number;
}

export interface ComplianceItem {
  id: string;
  contractId: string;
  contractNumber: string;
  milestoneName: string;
  dueDate: string;
  status: string;
}

export interface ActivityEvent {
  id: string;
  agentType: string;
  taskId: string;
  status: string;
  inputSummary: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Contract detail types ──────────────────────────────────────────

export interface ContractDetail extends ContractSummary {
  contractingOfficerName: string;
  contractingOfficerEmail: string;
  securityLevel: string;
  description: string;
  createdAt: string;
}

export interface ContractClause {
  id: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseType: string;
  fullText: string;
  riskCategory: string | null;
  analysisNotes: string | null;
}

export interface Modification {
  id: string;
  modNumber: string;
  modType: string;
  status: string;
  effectiveDate: string;
  description: string;
  ceilingDelta: string;
  fundingDelta: string;
}

export interface Deliverable {
  id: string;
  name: string;
  status: string;
  dueDate: string;
  lastSubmitted: string | null;
  description: string;
}

export interface ContractOption {
  id: string;
  optionNumber: number;
  optionStart: string;
  optionEnd: string;
  optionValue: string;
  exerciseDeadline: string;
  status: string;
}

export interface Communication {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  channel: string;
  subject: string;
  summary: string;
  createdAt: string;
}

export interface FsmTransition {
  to: string;
  requiredRole: string;
}

export interface FundingDataPoint {
  label: string;
  ceiling: number;
  funded: number;
}

// ─── Search / Ask types ─────────────────────────────────────────────

export interface SearchResult {
  id: string;
  contractId: string;
  contractNumber: string;
  sectionType: string;
  clauseNumber: string | null;
  chunkText: string;
  similarity: number;
}

export interface Citation {
  contractId: string;
  contractNumber: string;
  clauseNumber: string | null;
  sectionType: string;
  chunkText: string;
  relevance: number;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
}

// ─── Compliance dashboard types ─────────────────────────────────────

export interface OverdueItem {
  id: string;
  contractId: string;
  contractNumber: string;
  itemType: string;
  description: string;
  dueDate: string;
  daysOverdue: number;
  responsibleParty: string;
  status: string;
}

export interface FundingStatus {
  contractId: string;
  contractNumber: string;
  ceilingValue: string;
  fundedValue: string;
  percentFunded: number;
  projectedRunout: string | null;
  status: string;
}

export interface OptionWindow {
  id: string;
  contractId: string;
  contractNumber: string;
  optionNumber: number;
  exerciseDeadline: string;
  optionValue: string;
  status: string;
}

export interface CalendarDeadline {
  id: string;
  contractId: string;
  contractNumber: string;
  date: string;
  title: string;
  type: "deliverable" | "option" | "compliance" | "funding";
}

// ─── Request queue types ────────────────────────────────────────────

export type RequestType =
  | "NDA"
  | "MOU"
  | "NEW_CONTRACT"
  | "MOD"
  | "OPTION_EXERCISE"
  | "FUNDING_ACTION";

export type RequestStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export type RequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface ContractRequest {
  id: string;
  requestType: RequestType;
  title: string;
  summary: string;
  priority: RequestPriority;
  status: RequestStatus;
  requester: string;
  assignedTo: string | null;
  submittedAt: string;
  metadata: Record<string, unknown>;
}

// ─── Playbook types ─────────────────────────────────────────────────

export type RuleType =
  | "CLAUSE_REVIEW"
  | "RISK_ASSESSMENT"
  | "COMPLIANCE_CHECK"
  | "NEGOTIATION_POSITION";

export interface RuleConditions {
  clausePatterns: string[];
  contractTypes: string[];
  dollarThreshold: number | null;
  agencyFilters: string[];
}

export interface PlaybookRule {
  id: string;
  name: string;
  type: RuleType;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  standardPosition: string;
  riskIfDeviated: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  redlineTemplate: string;
  notes: string;
}

// ─── Agent monitoring types ────────────────────────────────────────

export type AgentType =
  | "CLAUSE_ANALYZER"
  | "COMPLIANCE_MONITOR"
  | "CONTRACT_INTELLIGENCE"
  | "MILESTONE_TRACKER"
  | "MODIFICATION_ANALYZER"
  | "OBLIGATION_EXTRACTOR"
  | "RISK_ASSESSOR";

export type AgentStatus = "ENABLED" | "DISABLED" | "ERROR";

export type ExecutionStatus = "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";

export interface AgentRegistryEntry {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  description: string;
  lastRunAt: string | null;
  successRate: number;
  avgExecutionTimeMs: number;
  totalRuns: number;
}

export interface AgentExecution {
  id: string;
  agentId: string;
  agentName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputSummary: string;
  outputSummary: string | null;
  error: string | null;
}

export interface SystemHealth {
  queueDepth: number;
  activeTasks: number;
  errorRate: number;
  uptime: string;
  lastHealthCheck: string;
}

// ─── Report types ──────────────────────────────────────────────────

export type ReportType =
  | "CONTRACT_STATUS"
  | "COMPLIANCE_SCORECARD"
  | "WORKLOAD_ANALYSIS"
  | "SLA_TRACKING"
  | "FUNDING_OVERVIEW"
  | "AGENT_PERFORMANCE";

export interface ReportResult {
  type: ReportType;
  generatedAt: string;
  startDate: string;
  endDate: string;
  summary: Record<string, number>;
  rows: Record<string, unknown>[];
  chartData: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  labels: string[];
}
