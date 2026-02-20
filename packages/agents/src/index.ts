/**
 * Forge Agent Orchestration
 * Agent framework, task queue, runner, and MCP integration.
 */

export { BaseAgent } from "./framework/base-agent.js";
export type {
  AgentTask,
  AgentResult,
  LLMOptions,
  SearchOpts,
  SearchResult,
  ContractContext,
  Transition,
  LLMProvider,
  VectorSearchProvider,
  DatabaseProvider,
  AuditProvider,
  FsmProvider,
  AgentDependencies,
} from "./framework/base-agent.js";

export { AgentRegistry } from "./framework/agent-registry.js";

export { TaskQueue } from "./framework/task-queue.js";
export type {
  TriggerType,
  Priority,
  TaskStatus,
  QueuedTask,
} from "./framework/task-queue.js";

export { AgentRunner } from "./framework/agent-runner.js";
export type { RunnerConfig, RunnerEvents } from "./framework/agent-runner.js";

export { ArcadeClient } from "./mcp/arcade-client.js";
export type { ToolResult, Tool, ArcadeClientConfig } from "./mcp/arcade-client.js";

export { IntakeClassifierAgent } from "./agents/intake-classifier.js";
export type {
  EmailPayload,
  SharePointFormPayload,
  IntakePayload,
  ClassificationResult,
  ExtractedMetadata,
  IntakeClassifierConfig,
} from "./agents/intake-classifier.js";

export { ContractIngestionAgent } from "./agents/contract-ingestion.js";
export type {
  S3EventPayload,
  IngestionResponse,
  ContractIngestionConfig,
  NlpPipelineClient,
  AgentTrigger,
} from "./agents/contract-ingestion.js";

export { ClauseDiffer } from "./agents/helpers/clause-differ.js";
export type { Clause, ClauseChange, ClauseDiff } from "./agents/helpers/clause-differ.js";

export { ClauseAnalysisAgent } from "./agents/clause-analysis.js";
export type {
  ClauseAnalysisPayload,
  ClauseRiskAssessment,
  ClauseAnalysisReport,
  ClauseAnalysisConfig,
  PrecedentCitation,
  RiskSeverity,
} from "./agents/clause-analysis.js";

export { PlaybookEngine, SAMPLE_PLAYBOOK_RULES } from "./agents/helpers/playbook-engine.js";
export type {
  PlaybookRule,
  PlaybookRuleConditions,
  PlaybookRuleActions,
  RuleMatch,
  ClauseInput,
} from "./agents/helpers/playbook-engine.js";

export { ComplianceMonitorAgent } from "./agents/compliance-monitor.js";
export type {
  ComplianceMonitorPayload,
  ComplianceFinding,
  ComplianceSummary,
  ComplianceMonitorConfig,
  FindingSeverity,
} from "./agents/compliance-monitor.js";

export { FundingCalculator } from "./agents/helpers/funding-calculator.js";
export type {
  ContractFundingData,
  FundingAnalysis,
  FundingAlert,
} from "./agents/helpers/funding-calculator.js";

export {
  FlowdownGeneratorAgent,
  determineClauseFlowdown,
  FLOWDOWN_RULES,
} from "./agents/flowdown-generator.js";
export type {
  FlowdownGeneratorPayload,
  FlowdownMatrixEntry,
  FlowdownGeneratorConfig,
  SubcontractProfile,
  PrimeClause,
  FlowdownBasis,
  FlowdownDeterminationRule,
} from "./agents/flowdown-generator.js";

export {
  ModCommunicationAgent,
  parseModReferences,
  parseClassificationResponse,
  calculateResponseDueDate,
} from "./agents/mod-communication.js";
export type {
  ModCommunicationPayload,
  InboundEmail,
  CommType,
  ParsedModReference,
  CommClassification,
  SF30Fields,
  OverdueAlert,
  ModCommunicationConfig,
} from "./agents/mod-communication.js";

export { TemplateEngine, STARTER_TEMPLATES } from "./agents/helpers/template-engine.js";
export type { Template } from "./agents/helpers/template-engine.js";

export {
  DocumentGenerationAgent,
  TEMPLATE_MAP,
  REQUIRED_FIELDS,
} from "./agents/document-generation.js";
export type {
  DocumentType,
  DocumentGenerationPayload,
  DocumentGenerationConfig,
} from "./agents/document-generation.js";

export {
  ContractIntelligenceAgent,
  parseIntelligenceResponse,
  computeConfidence,
} from "./agents/contract-intelligence.js";
export type {
  ContractIntelligencePayload,
  Citation as IntelligenceCitation,
  IntelligenceAnswer,
  ContractIntelligenceConfig,
} from "./agents/contract-intelligence.js";

export { buildRAGPrompt, SYSTEM_MESSAGE } from "./agents/prompts/contract-intelligence.js";
