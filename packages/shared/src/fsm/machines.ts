import type { FsmConfig } from "./types.js";

// ─── 1. PRIME_CONTRACT_FSM ──────────────────────────────────────────

export const PRIME_CONTRACT_STATES = [
  "OPPORTUNITY_IDENTIFIED",
  "PROPOSAL_IN_PROGRESS",
  "PROPOSAL_SUBMITTED",
  "AWARD_PENDING",
  "AWARDED",
  "ACTIVE",
  "OPTION_PENDING",
  "MOD_IN_PROGRESS",
  "STOP_WORK",
  "CLOSEOUT_PENDING",
  "CLOSED",
  "TERMINATED",
  "NOT_AWARDED",
] as const;

export type PrimeContractState = (typeof PRIME_CONTRACT_STATES)[number];

export const PRIME_CONTRACT_FSM: FsmConfig<PrimeContractState> = {
  name: "PRIME_CONTRACT_FSM",
  entityType: "PRIME_CONTRACT",
  states: PRIME_CONTRACT_STATES,
  transitions: [
    { from: "OPPORTUNITY_IDENTIFIED", to: "PROPOSAL_IN_PROGRESS", requiredRole: "contracts_team" },
    { from: "PROPOSAL_IN_PROGRESS", to: "PROPOSAL_SUBMITTED", requiredRole: "contracts_manager" },
    { from: "PROPOSAL_IN_PROGRESS", to: "OPPORTUNITY_IDENTIFIED", requiredRole: "contracts_team" },
    { from: "PROPOSAL_SUBMITTED", to: "AWARD_PENDING", requiredRole: "contracts_manager" },
    { from: "PROPOSAL_SUBMITTED", to: "NOT_AWARDED", requiredRole: "contracts_manager" },
    { from: "AWARD_PENDING", to: "AWARDED", requiredRole: "contracts_manager" },
    { from: "AWARDED", to: "ACTIVE", requiredRole: "contracts_manager" },
    { from: "ACTIVE", to: "OPTION_PENDING", requiredRole: "system" },
    { from: "ACTIVE", to: "MOD_IN_PROGRESS", requiredRole: "contracts_team" },
    { from: "ACTIVE", to: "STOP_WORK", requiredRole: "contracts_manager" },
    { from: "ACTIVE", to: "CLOSEOUT_PENDING", requiredRole: "contracts_manager" },
    { from: "ACTIVE", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "OPTION_PENDING", to: "ACTIVE", requiredRole: "contracts_manager" },
    { from: "MOD_IN_PROGRESS", to: "ACTIVE", requiredRole: "contracts_manager" },
    { from: "STOP_WORK", to: "ACTIVE", requiredRole: "contracts_manager" },
    { from: "STOP_WORK", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "CLOSEOUT_PENDING", to: "CLOSED", requiredRole: "contracts_manager" },
    { from: "TERMINATED", to: "CLOSED", requiredRole: "contracts_manager" },
  ],
};

// ─── 2. MODIFICATION_FSM ────────────────────────────────────────────

export const MODIFICATION_STATES = [
  "MOD_IDENTIFIED",
  "MOD_ANALYSIS",
  "MOD_DRAFTED",
  "MOD_UNDER_REVIEW",
  "MOD_SUBMITTED",
  "MOD_NEGOTIATION",
  "MOD_EXECUTED",
  "MOD_WITHDRAWN",
] as const;

export type ModificationState = (typeof MODIFICATION_STATES)[number];

export const MODIFICATION_FSM: FsmConfig<ModificationState> = {
  name: "MODIFICATION_FSM",
  entityType: "MODIFICATION",
  states: MODIFICATION_STATES,
  transitions: [
    { from: "MOD_IDENTIFIED", to: "MOD_ANALYSIS", requiredRole: "system" },
    { from: "MOD_ANALYSIS", to: "MOD_DRAFTED", requiredRole: "system" },
    { from: "MOD_DRAFTED", to: "MOD_UNDER_REVIEW", requiredRole: "contracts_team" },
    { from: "MOD_UNDER_REVIEW", to: "MOD_SUBMITTED", requiredRole: "contracts_manager" },
    { from: "MOD_UNDER_REVIEW", to: "MOD_DRAFTED", requiredRole: "contracts_manager" },
    { from: "MOD_SUBMITTED", to: "MOD_NEGOTIATION", requiredRole: "contracts_team" },
    { from: "MOD_SUBMITTED", to: "MOD_EXECUTED", requiredRole: "contracts_manager" },
    { from: "MOD_NEGOTIATION", to: "MOD_EXECUTED", requiredRole: "contracts_manager" },
    { from: "MOD_NEGOTIATION", to: "MOD_WITHDRAWN", requiredRole: "contracts_manager" },
  ],
};

// ─── 3. NDA_FSM ─────────────────────────────────────────────────────

export const NDA_STATES = [
  "REQUESTED",
  "DRAFTED",
  "INTERNAL_REVIEW",
  "SENT_TO_COUNTERPARTY",
  "NEGOTIATION",
  "EXECUTED",
  "EXPIRED",
  "RENEWED",
  "TERMINATED",
] as const;

export type NdaState = (typeof NDA_STATES)[number];

export const NDA_FSM: FsmConfig<NdaState> = {
  name: "NDA_FSM",
  entityType: "NDA",
  states: NDA_STATES,
  transitions: [
    { from: "REQUESTED", to: "DRAFTED", requiredRole: "system" },
    { from: "DRAFTED", to: "INTERNAL_REVIEW", requiredRole: "contracts_team" },
    { from: "INTERNAL_REVIEW", to: "SENT_TO_COUNTERPARTY", requiredRole: "contracts_manager" },
    { from: "INTERNAL_REVIEW", to: "DRAFTED", requiredRole: "contracts_manager" },
    { from: "SENT_TO_COUNTERPARTY", to: "NEGOTIATION", requiredRole: "contracts_team" },
    { from: "SENT_TO_COUNTERPARTY", to: "EXECUTED", requiredRole: "contracts_manager" },
    { from: "NEGOTIATION", to: "EXECUTED", requiredRole: "contracts_manager" },
    { from: "NEGOTIATION", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "EXECUTED", to: "EXPIRED", requiredRole: "system" },
    { from: "EXECUTED", to: "RENEWED", requiredRole: "contracts_manager" },
    { from: "EXECUTED", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "EXPIRED", to: "RENEWED", requiredRole: "contracts_manager" },
    { from: "RENEWED", to: "EXECUTED", requiredRole: "contracts_manager" },
  ],
};

// ─── 4. MOU_FSM ─────────────────────────────────────────────────────

export const MOU_STATES = [
  "REQUESTED",
  "DRAFTED",
  "INTERNAL_REVIEW",
  "SENT_TO_COUNTERPARTY",
  "NEGOTIATION",
  "EXECUTED",
  "EXPIRED",
  "RENEWED",
  "TERMINATED",
] as const;

export type MouState = (typeof MOU_STATES)[number];

export const MOU_FSM: FsmConfig<MouState> = {
  name: "MOU_FSM",
  entityType: "MOU",
  states: MOU_STATES,
  transitions: [
    { from: "REQUESTED", to: "DRAFTED", requiredRole: "system" },
    { from: "DRAFTED", to: "INTERNAL_REVIEW", requiredRole: "contracts_team" },
    { from: "INTERNAL_REVIEW", to: "SENT_TO_COUNTERPARTY", requiredRole: "contracts_manager" },
    { from: "INTERNAL_REVIEW", to: "DRAFTED", requiredRole: "contracts_manager" },
    { from: "SENT_TO_COUNTERPARTY", to: "NEGOTIATION", requiredRole: "contracts_team" },
    { from: "SENT_TO_COUNTERPARTY", to: "EXECUTED", requiredRole: "contracts_manager" },
    { from: "NEGOTIATION", to: "EXECUTED", requiredRole: "contracts_manager" },
    { from: "NEGOTIATION", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "EXECUTED", to: "EXPIRED", requiredRole: "system" },
    { from: "EXECUTED", to: "RENEWED", requiredRole: "contracts_manager" },
    { from: "EXECUTED", to: "TERMINATED", requiredRole: "contracts_manager" },
    { from: "EXPIRED", to: "RENEWED", requiredRole: "contracts_manager" },
    { from: "RENEWED", to: "EXECUTED", requiredRole: "contracts_manager" },
  ],
};
