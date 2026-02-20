import type { PageServerLoad } from "./$types.js";
import type {
  ComplianceItem,
  OverdueItem,
  FundingStatus,
  OptionWindow,
  CalendarDeadline,
} from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch, url }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const now = new Date();
  const year = parseInt(url.searchParams.get("year") ?? String(now.getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(now.getMonth() + 1));

  const [
    dueThisWeekRes,
    overdueRes,
    upcomingRes,
    optionWindowsRes,
    fundingStatusRes,
    calendarRes,
  ] = await Promise.allSettled([
    skFetch(`${apiBase}/compliance/upcoming?days=7`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    ),
    skFetch(`${apiBase}/compliance/overdue/detailed`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    ),
    skFetch(`${apiBase}/compliance/upcoming?days=30`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    ),
    skFetch(`${apiBase}/compliance/option-windows?days=90`, { headers }).then(
      (r) => (r.ok ? r.json() : []),
    ),
    skFetch(`${apiBase}/compliance/funding-status`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    ),
    skFetch(`${apiBase}/compliance/calendar?year=${year}&month=${month}`, {
      headers,
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  return {
    dueThisWeek: (dueThisWeekRes.status === "fulfilled"
      ? dueThisWeekRes.value
      : []) as ComplianceItem[],
    overdueItems: (overdueRes.status === "fulfilled"
      ? overdueRes.value
      : []) as OverdueItem[],
    upcoming: (upcomingRes.status === "fulfilled"
      ? upcomingRes.value
      : []) as ComplianceItem[],
    optionWindows: (optionWindowsRes.status === "fulfilled"
      ? optionWindowsRes.value
      : []) as OptionWindow[],
    fundingStatus: (fundingStatusRes.status === "fulfilled"
      ? fundingStatusRes.value
      : []) as FundingStatus[],
    calendarDeadlines: (calendarRes.status === "fulfilled"
      ? calendarRes.value
      : []) as CalendarDeadline[],
    calendarYear: year,
    calendarMonth: month,
  };
};
