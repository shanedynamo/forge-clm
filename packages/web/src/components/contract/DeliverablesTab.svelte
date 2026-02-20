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
    <p class="text-sm text-gray-400">No deliverables found</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Name</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Status</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Due Date</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Last Submitted</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Description</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {#each deliverables as d (d.id)}
            <tr
              class="{isOverdue(d) ? 'bg-red-50' : ''}"
              data-testid="deliverable-row"
              data-overdue={isOverdue(d) ? "true" : undefined}
            >
              <td class="px-4 py-3 font-medium text-gray-900">{d.name}</td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(d.status)}">
                  {statusLabel(d.status)}
                </span>
              </td>
              <td class="px-4 py-3 {isOverdue(d) ? 'font-semibold text-red-700' : 'text-gray-600'}">
                {formatDate(d.dueDate)}
                {#if isOverdue(d)}
                  <span class="ml-1 text-xs text-red-500" data-testid="overdue-badge">OVERDUE</span>
                {/if}
              </td>
              <td class="px-4 py-3 text-gray-600">{d.lastSubmitted ? formatDate(d.lastSubmitted) : "—"}</td>
              <td class="px-4 py-3 text-gray-500">{d.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
