<script lang="ts">
  import type { Deliverable } from "$lib/types.js";
  import { formatDate, daysUntil, statusColor, statusLabel } from "$lib/format.js";

  export let deliverables: Deliverable[];

  function isOverdue(d: Deliverable): boolean {
    return d.status !== "COMPLETED" && d.status !== "WAIVED" && daysUntil(d.dueDate) < 0;
  }
</script>

<div data-testid="deliverables-tab">
  {#if deliverables.length === 0}
    <p class="text-sm font-body text-slate-400">No deliverables found</p>
  {:else}
    <div class="overflow-x-auto border border-slate-300 bg-white rounded-lg shadow-sm">
      <table class="dynamo-table w-full text-left text-sm">
        <thead class="border-b border-slate-300 bg-slate-100">
          <tr>
            <th class="px-4 py-3 text-xs font-heading font-semibold uppercase tracking-wide text-slate-700">Name</th>
            <th class="px-4 py-3 text-xs font-heading font-semibold uppercase tracking-wide text-slate-700">Status</th>
            <th class="px-4 py-3 text-xs font-heading font-semibold uppercase tracking-wide text-slate-700">Due Date</th>
            <th class="px-4 py-3 text-xs font-heading font-semibold uppercase tracking-wide text-slate-700">Last Submitted</th>
            <th class="px-4 py-3 text-xs font-heading font-semibold uppercase tracking-wide text-slate-700">Description</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          {#each deliverables as d (d.id)}
            <tr
              class="{isOverdue(d) ? 'bg-red-50' : ''}"
              data-testid="deliverable-row"
              data-overdue={isOverdue(d) ? "true" : undefined}
            >
              <td class="px-4 py-3 font-medium font-body text-slate-900">{d.name}</td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(d.status)}">
                  {statusLabel(d.status)}
                </span>
              </td>
              <td class="px-4 py-3 font-mono {isOverdue(d) ? 'font-semibold text-red-700' : 'text-slate-700'}">
                {formatDate(d.dueDate)}
                {#if isOverdue(d)}
                  <span class="ml-1 text-xs text-red-500" data-testid="overdue-badge">OVERDUE</span>
                {/if}
              </td>
              <td class="px-4 py-3 font-mono text-slate-700">{d.lastSubmitted ? formatDate(d.lastSubmitted) : "—"}</td>
              <td class="px-4 py-3 font-body text-slate-500">{d.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
