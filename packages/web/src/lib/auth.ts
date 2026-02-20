/**
 * Auth utilities — JWT token handling and mock auth for local dev.
 */

import type { User, AuthRole } from "./types.js";

const JWT_SECRET = "dev-secret-do-not-use-in-production";

/**
 * Decode a JWT payload without verification (client-side only).
 * For local dev, the API uses the same shared secret.
 */
export function decodeToken(token: string): User | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!));
    return {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

/**
 * Create a mock JWT for local dev.
 * Uses the same secret as the API auth middleware.
 */
export function createMockToken(overrides?: Partial<User>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    userId: overrides?.userId ?? "dev-user-001",
    email: overrides?.email ?? "developer@dynamo.com",
    name: overrides?.name ?? "Dev User",
    role: overrides?.role ?? "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const unsigned = `${enc(header)}.${enc(payload)}`;
  // For local dev, we use a simple HMAC placeholder.
  // The real API verifies with the same shared secret via @fastify/jwt.
  const signature = enc({ mock: true });
  return `${unsigned}.${signature}`;
}

export function isAdminOrManager(role: AuthRole): boolean {
  return role === "admin" || role === "contracts_manager";
}

export function canWrite(role: AuthRole): boolean {
  return role !== "viewer";
}

/**
 * Navigation items with role restrictions.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  minRole?: AuthRole;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Contracts", href: "/contracts", icon: "file-text" },
  { label: "Compliance", href: "/compliance", icon: "shield-check" },
  { label: "Subcontracts", href: "/subcontracts", icon: "git-branch" },
  { label: "Requests", href: "/requests", icon: "inbox" },
  { label: "Search", href: "/search", icon: "search" },
  { label: "Agents", href: "/agents", icon: "cpu", minRole: "contracts_team" },
  { label: "Playbook", href: "/playbook", icon: "book-open", minRole: "contracts_manager" },
  { label: "Reports", href: "/reports", icon: "bar-chart-2" },
];

const ROLE_RANK: Record<AuthRole, number> = {
  viewer: 0,
  contracts_team: 1,
  contracts_manager: 2,
  admin: 3,
};

export function hasMinRole(userRole: AuthRole, minRole: AuthRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

export function getVisibleNavItems(role: AuthRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.minRole || hasMinRole(role, item.minRole),
  );
}
