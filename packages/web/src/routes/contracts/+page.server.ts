import type { PageServerLoad } from "./$types.js";
import type { ContractSummary, PaginatedResponse } from "$lib/types.js";

export const load: PageServerLoad = async ({ locals, fetch: skFetch, url }) => {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
  const token = locals.token;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const page = url.searchParams.get("page") ?? "1";
  const limit = url.searchParams.get("limit") ?? "20";
  const sort = url.searchParams.get("sort") ?? "";
  const search = url.searchParams.get("search") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const contractType = url.searchParams.get("contractType") ?? "";
  const agency = url.searchParams.get("agency") ?? "";

  const query = new URLSearchParams({ page, limit });
  if (sort) query.set("sort", sort);

  const filters: string[] = [];
  if (status) filters.push(`status:${status}`);
  if (contractType) filters.push(`contractType:${contractType}`);
  if (agency) filters.push(`agency:${agency}`);
  if (search) filters.push(`search:${search}`);
  if (filters.length) query.set("filter", filters.join(","));

  try {
    const res = await skFetch(`${apiBase}/contracts?${query}`, { headers });
    if (!res.ok) {
      return { contracts: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, search, status, contractType, agency, sort };
    }
    const data = (await res.json()) as PaginatedResponse<ContractSummary>;
    return { ...data, search, status, contractType, agency, sort };
  } catch {
    return { contracts: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, search, status, contractType, agency, sort };
  }
};
