import type { PageServerLoad } from "./$types.js";
import type { ContractRequest } from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  try {
    const res = await skFetch(`${apiBase}/requests`, { headers });
    if (!res.ok) return { requests: [] as ContractRequest[] };
    const requests = (await res.json()) as ContractRequest[];
    return { requests };
  } catch {
    return { requests: [] as ContractRequest[] };
  }
};
