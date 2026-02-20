import type { PageServerLoad } from "./$types.js";
import type { PlaybookRule } from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  try {
    const res = await skFetch(`${apiBase}/playbook/rules`, { headers });
    if (!res.ok) return { rules: [] as PlaybookRule[] };
    const rules = (await res.json()) as PlaybookRule[];
    return { rules };
  } catch {
    return { rules: [] as PlaybookRule[] };
  }
};
