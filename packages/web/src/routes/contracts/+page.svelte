<script lang="ts">
  import type { ContractSummary, PaginatedResponse } from "$lib/types.js";
  import { formatCurrency, formatDate, statusColor, statusLabel } from "$lib/format.js";
  import { canWrite } from "$lib/auth.js";
  import type { AuthRole } from "$lib/types.js";
  import { Search } from "lucide-svelte";

  export let data: PaginatedResponse<ContractSummary> & {
    search: string;
    status: string;
    contractType: string;
    agency: string;
    sort: string;
  };

  const contracts = data.data ?? [];
  const pagination = data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };

  // Sort state
  let currentSort = data.sort ?? "";

  function sortUrl(column: string): string {
    const next = currentSort === column ? `-${column}` : currentSort === `-${column}` ? "" : column;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    if (next) params.set("sort", next);
    else params.delete("sort");
    params.set("page", "1");
    return `?${params}`;
  }

  function sortIndicator(column: string): string {
    if (currentSort === column) return " \u25B2";
    if (currentSort === `-${column}`) return " \u25BC";
    return "";
  }

  function pageUrl(p: number): string {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    params.set("page", String(p));
    return `?${params}`;
  }

  const CONTRACT_TYPES = ["FFP", "CPFF", "CPIF", "CPAF", "T&M", "IDIQ", "BPA"];
  const STATUS_OPTIONS = [
    "OPPORTUNITY_IDENTIFIED", "PROPOSAL_IN_PROGRESS", "PROPOSAL_SUBMITTED",
    "AWARD_PENDING", "AWARDED", "ACTIVE", "OPTION_PENDING",
    "MOD_IN_PROGRESS", "STOP_WORK", "CLOSEOUT_PENDING", "CLOSED",
    "TERMINATED", "NOT_AWARDED",
  ];

  const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
    { key: "contractNumber", label: "Contract #", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "contractType", label: "Type", sortable: true },
    { key: "ceilingValue", label: "Ceiling Value", sortable: true },
    { key: "fundedValue", label: "Funded Value", sortable: true },
    { key: "awardingAgency", label: "Agency", sortable: true },
    { key: "popStart", label: "PoP Start", sortable: true },
    { key: "popEnd", label: "PoP End", sortable: true },
  ];
</script>

<div class="page-enter flex gap-6" data-testid="contracts-page">
  <!-- Filter Sidebar -->
  <aside class="hidden w-56 shrink-0 lg:block" data-testid="filter-sidebar">
    <form method="get" class="space-y-4 rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
      <h3 class="font-heading text-sm font-semibold text-slate-900">Filters</h3>

      <div>
        <label for="filter-status" class="block font-body text-xs font-medium text-slate-700">Status</label>
        <select id="filter-status" name="status" class="mt-1 w-full rounded-lg border-slate-300 text-sm" value={data.status}>
          <option value="">All</option>
          {#each STATUS_OPTIONS as s}
            <option value={s}>{statusLabel(s)}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="filter-type" class="block font-body text-xs font-medium text-slate-700">Contract Type</label>
        <select id="filter-type" name="contractType" class="mt-1 w-full rounded-lg border-slate-300 text-sm" value={data.contractType}>
          <option value="">All</option>
          {#each CONTRACT_TYPES as t}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="filter-agency" class="block font-body text-xs font-medium text-slate-700">Agency</label>
        <input
          id="filter-agency"
          name="agency"
          type="text"
          placeholder="e.g. USAF"
          class="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-coral focus:ring-2 focus:ring-coral/50"
          value={data.agency}
        />
      </div>

      <button
        type="submit"
        class="dynamo-btn w-full rounded-lg bg-coral px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 active:scale-[0.98]"
      >
        Apply Filters
      </button>
    </form>
  </aside>

  <!-- Main Content -->
  <div class="min-w-0 flex-1">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="font-heading text-lg font-semibold text-slate-900">Contracts</h2>
        <span class="font-body text-sm text-slate-700">({pagination.total} total)</span>
      </div>

      <a
        href="/contracts/new"
        class="dynamo-btn inline-flex items-center gap-1.5 rounded-lg bg-coral px-3 py-2 text-sm font-medium text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        data-testid="new-contract-btn"
      >
        + New Contract
      </a>
    </div>

    <!-- Search -->
    <form method="get" class="mb-4">
      <div class="relative">
        <input
          name="search"
          type="text"
          placeholder="Search by contract number..."
          value={data.search}
          class="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-4 font-body text-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/50"
          data-testid="search-input"
        />
        <Search class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      </div>
    </form>

    <!-- Data Table -->
    <div class="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
      <table class="dynamo-table w-full text-left text-sm" data-testid="contracts-table">
        <thead class="border-b border-slate-200 bg-slate-100">
          <tr>
            {#each COLUMNS as col}
              <th class="whitespace-nowrap px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-slate-700">
                {#if col.sortable}
                  <a href={sortUrl(col.key)} class="hover:text-coral" data-testid="sort-{col.key}">
                    {col.label}{sortIndicator(col.key)}
                  </a>
                {:else}
                  {col.label}
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          {#if contracts.length === 0}
            <tr>
              <td colspan={COLUMNS.length} class="px-4 py-12 text-center" data-testid="empty-state">
                <p class="font-heading text-base font-semibold text-slate-900">No contracts found</p>
                <p class="mt-1 font-body text-sm text-slate-700">Try adjusting your filters or search terms.</p>
              </td>
            </tr>
          {:else}
            {#each contracts as contract (contract.id)}
              <tr
                class="cursor-pointer transition-colors"
                data-testid="contract-row"
              >
                <td class="px-4 py-3">
                  <a href="/contracts/{contract.id}" class="font-medium text-coral hover:text-coral-700">
                    {contract.contractNumber}
                  </a>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {statusColor(contract.status)}"
                    data-testid="status-badge"
                  >
                    {statusLabel(contract.status)}
                  </span>
                </td>
                <td class="px-4 py-3 font-body text-slate-700">{contract.contractType}</td>
                <td class="px-4 py-3 font-body font-medium text-slate-900">{formatCurrency(contract.ceilingValue)}</td>
                <td class="px-4 py-3 font-body font-medium text-slate-900">{formatCurrency(contract.fundedValue)}</td>
                <td class="px-4 py-3 font-body text-slate-700">{contract.awardingAgency}</td>
                <td class="px-4 py-3 font-mono text-slate-700">{formatDate(contract.popStart)}</td>
                <td class="px-4 py-3 font-mono text-slate-700">{formatDate(contract.popEnd)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if pagination.totalPages > 1}
      <nav class="mt-4 flex items-center justify-between" data-testid="pagination">
        <span class="font-body text-sm text-slate-700">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <div class="flex gap-1">
          {#if pagination.page > 1}
            <a
              href={pageUrl(pagination.page - 1)}
              class="rounded-lg border border-slate-300 bg-white px-3 py-1 font-body text-sm text-slate-700 hover:bg-slate-100"
              data-testid="prev-page"
            >
              Previous
            </a>
          {/if}
          {#if pagination.page < pagination.totalPages}
            <a
              href={pageUrl(pagination.page + 1)}
              class="rounded-lg border border-slate-300 bg-white px-3 py-1 font-body text-sm text-slate-700 hover:bg-slate-100"
              data-testid="next-page"
            >
              Next
            </a>
          {/if}
        </div>
      </nav>
    {/if}
  </div>
</div>
