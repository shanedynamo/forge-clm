import type {
  FsmConfig,
  FsmRole,
  FsmAuditLogger,
  TransitionContext,
  HookFn,
  TransitionDef,
  EntityType,
} from "./types.js";
import { FsmError } from "./types.js";

// ─── FSM Engine ──────────────────────────────────────────────────────

export class FsmEngine<S extends string> {
  private readonly stateSet: Set<S>;
  private readonly transitionMap: Map<string, TransitionDef<S>>;
  private readonly onEnterHooks: Map<S, HookFn<S>[]>;
  private readonly onExitHooks: Map<S, HookFn<S>[]>;
  private auditLogger: FsmAuditLogger | null = null;

  constructor(public readonly config: FsmConfig<S>) {
    this.stateSet = new Set(config.states);
    this.transitionMap = new Map();
    this.onEnterHooks = new Map();
    this.onExitHooks = new Map();

    for (const t of config.transitions) {
      const key = `${t.from}->${t.to}`;
      this.transitionMap.set(key, t);
    }
  }

  // ─── Hook registration ─────────────────────────────────────────────

  onEnter(state: S, hook: HookFn<S>): this {
    const hooks = this.onEnterHooks.get(state) ?? [];
    hooks.push(hook);
    this.onEnterHooks.set(state, hooks);
    return this;
  }

  onExit(state: S, hook: HookFn<S>): this {
    const hooks = this.onExitHooks.get(state) ?? [];
    hooks.push(hook);
    this.onExitHooks.set(state, hooks);
    return this;
  }

  setAuditLogger(logger: FsmAuditLogger): this {
    this.auditLogger = logger;
    return this;
  }

  // ─── Transition execution ───────────────────────────────────────────

  async transition(
    currentState: S,
    toState: S,
    userId: string,
    role: FsmRole,
    entityId: string = "unknown",
  ): Promise<S> {
    const timestamp = new Date();

    // Validate states exist
    if (!this.stateSet.has(currentState)) {
      const err = new FsmError(
        `Invalid current state: "${currentState}"`,
        "INVALID_STATE",
        { currentState, validStates: [...this.stateSet] },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    if (!this.stateSet.has(toState)) {
      const err = new FsmError(
        `Invalid target state: "${toState}"`,
        "INVALID_STATE",
        { toState, validStates: [...this.stateSet] },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    // Look up transition
    const key = `${currentState}->${toState}`;
    const transitionDef = this.transitionMap.get(key);

    if (!transitionDef) {
      const err = new FsmError(
        `Transition from "${currentState}" to "${toState}" is not allowed`,
        "INVALID_TRANSITION",
        { currentState, toState, allowedTargets: this.getTargetsFrom(currentState) },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    // Validate role
    if (!this.hasRequiredRole(role, transitionDef.requiredRole)) {
      const err = new FsmError(
        `Role "${role}" is not authorized for transition "${currentState}" -> "${toState}" (requires "${transitionDef.requiredRole}")`,
        "UNAUTHORIZED_ROLE",
        { role, requiredRole: transitionDef.requiredRole },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    // Build context
    const ctx: TransitionContext<S> = {
      entityType: this.config.entityType,
      entityId,
      from: currentState,
      to: toState,
      role,
      userId,
      timestamp,
    };

    // Execute on_exit hooks
    try {
      await this.runHooks(this.onExitHooks.get(currentState), ctx);
    } catch (hookErr) {
      const message = hookErr instanceof Error ? hookErr.message : String(hookErr);
      const err = new FsmError(
        `on_exit hook failed for state "${currentState}": ${message}`,
        "HOOK_FAILED",
        { state: currentState, hookType: "on_exit" },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    // Execute on_enter hooks
    try {
      await this.runHooks(this.onEnterHooks.get(toState), ctx);
    } catch (hookErr) {
      const message = hookErr instanceof Error ? hookErr.message : String(hookErr);
      const err = new FsmError(
        `on_enter hook failed for state "${toState}": ${message}`,
        "HOOK_FAILED",
        { state: toState, hookType: "on_enter" },
      );
      await this.logTransition(entityId, currentState, toState, userId, role, false, err.message, timestamp);
      throw err;
    }

    // Log success
    await this.logTransition(entityId, currentState, toState, userId, role, true, undefined, timestamp);

    return toState;
  }

  // ─── Query methods ──────────────────────────────────────────────────

  getAvailableTransitions(currentState: S, role: FsmRole): TransitionDef<S>[] {
    const results: TransitionDef<S>[] = [];
    for (const t of this.config.transitions) {
      if (t.from === currentState && this.hasRequiredRole(role, t.requiredRole)) {
        results.push(t);
      }
    }
    return results;
  }

  getTargetsFrom(state: S): S[] {
    return this.config.transitions
      .filter((t) => t.from === state)
      .map((t) => t.to);
  }

  isValidState(state: string): state is S {
    return this.stateSet.has(state as S);
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  private hasRequiredRole(userRole: FsmRole, requiredRole: FsmRole): boolean {
    // Role hierarchy: contracts_manager > contracts_team > system
    // Higher roles can do what lower roles can do
    const hierarchy: Record<FsmRole, number> = {
      system: 0,
      contracts_team: 1,
      contracts_manager: 2,
    };
    // "system" role is special — only system can use system transitions
    if (requiredRole === "system") {
      return userRole === "system";
    }
    return hierarchy[userRole]! >= hierarchy[requiredRole]!;
  }

  private async runHooks(hooks: HookFn<S>[] | undefined, ctx: TransitionContext<S>): Promise<void> {
    if (!hooks) return;
    for (const hook of hooks) {
      await hook(ctx);
    }
  }

  private async logTransition(
    entityId: string,
    fromState: string,
    toState: string,
    userId: string,
    role: FsmRole,
    success: boolean,
    errorMessage: string | undefined,
    timestamp: Date,
  ): Promise<void> {
    if (!this.auditLogger) return;
    try {
      await this.auditLogger.log({
        entityType: this.config.entityType,
        entityId,
        fromState,
        toState,
        userId,
        role,
        success,
        errorMessage,
        timestamp,
      });
    } catch {
      // Audit logging should never break the FSM
    }
  }
}
