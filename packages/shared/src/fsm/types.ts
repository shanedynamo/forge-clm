// ─── Roles ───────────────────────────────────────────────────────────

export const FSM_ROLES = ["system", "contracts_team", "contracts_manager"] as const;
export type FsmRole = (typeof FSM_ROLES)[number];

// ─── Entity types ────────────────────────────────────────────────────

export const ENTITY_TYPES = ["PRIME_CONTRACT", "MODIFICATION", "NDA", "MOU"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ─── Transition definition ───────────────────────────────────────────

export interface TransitionDef<S extends string = string> {
  from: S;
  to: S;
  requiredRole: FsmRole;
}

// ─── Hook types ──────────────────────────────────────────────────────

export interface TransitionContext<S extends string = string> {
  entityType: EntityType;
  entityId: string;
  from: S;
  to: S;
  role: FsmRole;
  userId: string;
  timestamp: Date;
}

export type HookFn<S extends string = string> = (ctx: TransitionContext<S>) => void | Promise<void>;

// ─── FSM configuration ──────────────────────────────────────────────

export interface FsmConfig<S extends string = string> {
  name: string;
  entityType: EntityType;
  states: readonly S[];
  transitions: readonly TransitionDef<S>[];
}

// ─── Audit logger interface ──────────────────────────────────────────

export interface FsmAuditLogger {
  log(entry: {
    entityType: EntityType;
    entityId: string;
    fromState: string;
    toState: string;
    userId: string;
    role: FsmRole;
    success: boolean;
    errorMessage?: string;
    timestamp: Date;
  }): void | Promise<void>;
}

// ─── Error types ─────────────────────────────────────────────────────

export class FsmError extends Error {
  constructor(
    message: string,
    public readonly code: FsmErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FsmError";
  }
}

export type FsmErrorCode =
  | "INVALID_TRANSITION"
  | "INVALID_STATE"
  | "UNAUTHORIZED_ROLE"
  | "HOOK_FAILED";
