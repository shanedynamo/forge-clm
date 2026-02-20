import { z } from "zod";
import { asc, desc, sql, type SQL, type Column } from "drizzle-orm";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@forge/shared";

// ─── Query params schema ────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().optional(),
  filter: z.string().optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

// ─── Paginated response builder ─────────────────────────────────────

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: Pick<PaginationParams, "page" | "limit">,
) {
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}

// ─── Sort param parser ──────────────────────────────────────────────

export function parseSortParam(
  sort: string | undefined,
  columnMap: Record<string, Column>,
  defaultSort: SQL,
): SQL {
  if (!sort) return defaultSort;

  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  const column = columnMap[field];

  if (!column) return defaultSort;
  return descending ? desc(column) : asc(column);
}

// ─── Filter param parser ────────────────────────────────────────────

export function parseFilterParam(
  filter: string | undefined,
  columnMap: Record<string, Column>,
): SQL[] {
  if (!filter) return [];

  const conditions: SQL[] = [];
  const pairs = filter.split(",");

  for (const pair of pairs) {
    const [key, value] = pair.split(":");
    if (!key || !value) continue;

    const column = columnMap[key];
    if (!column) continue;

    conditions.push(sql`${column} = ${value}`);
  }

  return conditions;
}
