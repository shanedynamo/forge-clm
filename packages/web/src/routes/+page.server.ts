import type { PageServerLoad } from "./$types.js";
import type { DashboardMetrics, ComplianceItem, ActivityEvent } from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch }) => {
  const apiBase =
    process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;

  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  // Parallel fetch all dashboard data
  const [metricsRes, complianceRes, overdueRes, activityRes] =
    await Promise.allSettled([
      skFetch(`${apiBase}/dashboard/metrics`, { headers }).then((r) =>
        r.ok ? r.json() : null,
      ),
      skFetch(`${apiBase}/compliance/upcoming?days=7`, { headers }).then(
        (r) => (r.ok ? r.json() : []),
      ),
      skFetch(`${apiBase}/compliance/overdue`, { headers }).then((r) =>
        r.ok ? r.json() : [],
      ),
      skFetch(`${apiBase}/activity/recent?limit=20`, { headers }).then(
        (r) => (r.ok ? r.json() : []),
      ),
    ]);

  return {
    metrics: (metricsRes.status === "fulfilled"
      ? metricsRes.value
      : null) as DashboardMetrics | null,
    complianceDue: (complianceRes.status === "fulfilled"
      ? complianceRes.value
      : []) as ComplianceItem[],
    overdueItems: (overdueRes.status === "fulfilled"
      ? overdueRes.value
      : []) as ComplianceItem[],
    activity: (activityRes.status === "fulfilled"
      ? activityRes.value
      : []) as ActivityEvent[],
  };
};
