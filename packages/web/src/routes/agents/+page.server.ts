import type { PageServerLoad } from "./$types.js";
import type { AgentRegistryEntry, SystemHealth } from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const [agentsRes, healthRes] = await Promise.all([
    skFetch(`${apiBase}/agents`, { headers }).catch(() => null),
    skFetch(`${apiBase}/system/health`, { headers }).catch(() => null),
  ]);

  const agents: AgentRegistryEntry[] = agentsRes?.ok
    ? await agentsRes.json()
    : [];

  const health: SystemHealth = healthRes?.ok
    ? await healthRes.json()
    : { queueDepth: 0, activeTasks: 0, errorRate: 0, uptime: "—", lastHealthCheck: "" };

  return {
    agents,
    health,
    userRole: locals.user?.role ?? "viewer",
  };
};
