import type { FsmRole } from "@forge/shared";
import { AppError } from "./errors.js";

export type AuthRole = "admin" | "contracts_manager" | "contracts_team" | "viewer";

const AUTH_TO_FSM: Record<AuthRole, FsmRole | null> = {
  admin: "contracts_manager",
  contracts_manager: "contracts_manager",
  contracts_team: "contracts_team",
  viewer: null,
};

export function toFsmRole(authRole: AuthRole): FsmRole {
  const fsmRole = AUTH_TO_FSM[authRole];
  if (!fsmRole) {
    throw new AppError("Viewers cannot perform FSM transitions", 403);
  }
  return fsmRole;
}
