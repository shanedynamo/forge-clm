import type { PageServerLoad } from "./$types.js";
import type {
  ContractDetail,
  ContractClause,
  Modification,
  Deliverable,
  ComplianceItem,
  ContractOption,
  Communication,
  FsmTransition,
} from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch, params }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const id = params.id;
  const base = `${apiBase}/contracts/${id}`;

  const [
    contractRes,
    clausesRes,
    modsRes,
    deliverablesRes,
    complianceRes,
    optionsRes,
    commsRes,
    transitionsRes,
  ] = await Promise.allSettled([
    skFetch(base, { headers }).then((r) => (r.ok ? r.json() : null)),
    skFetch(`${base}/clauses`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/mods`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/deliverables`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/compliance`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/options`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/communications`, { headers }).then((r) => (r.ok ? r.json() : [])),
    skFetch(`${base}/transitions`, { headers }).then((r) => (r.ok ? r.json() : [])),
  ]);

  return {
    contract: (contractRes.status === "fulfilled" ? contractRes.value : null) as ContractDetail | null,
    clauses: (clausesRes.status === "fulfilled" ? clausesRes.value : []) as ContractClause[],
    modifications: (modsRes.status === "fulfilled" ? modsRes.value : []) as Modification[],
    deliverables: (deliverablesRes.status === "fulfilled" ? deliverablesRes.value : []) as Deliverable[],
    compliance: (complianceRes.status === "fulfilled" ? complianceRes.value : []) as ComplianceItem[],
    options: (optionsRes.status === "fulfilled" ? optionsRes.value : []) as ContractOption[],
    communications: (commsRes.status === "fulfilled" ? commsRes.value : []) as Communication[],
    transitions: (transitionsRes.status === "fulfilled" ? transitionsRes.value : []) as FsmTransition[],
  };
};
