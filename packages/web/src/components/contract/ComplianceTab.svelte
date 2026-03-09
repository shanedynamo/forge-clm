<script lang="ts">
  import type { ComplianceItem } from "$lib/types.js";
  import { formatDate, daysUntil, statusColor, statusLabel } from "$lib/format.js";

  export let compliance: ComplianceItem[];

  function urgencyClass(item: ComplianceItem): string {
    if (item.status === "COMPLETED" || item.status === "WAIVED") return "";
    const days = daysUntil(item.dueDate);
    if (days < 0) return "border-l-4 border-l-red-500";
    if (days <= 7) return "border-l-4 border-l-amber-500";
    return "border-l-4 border-l-green-500";
  }
</script>

<div data-testid="compliance-tab">
  {#if compliance.length === 0}
    <p class="text-sm font-body text-slate-400">No compliance milestones found</p>
  {:else}
    <div class="space-y-2">
      {#each compliance as item (item.id)}
        <div
          class="flex items-center justify-between border border-slate-300 bg-white rounded-lg shadow-sm px-4 py-3 transition-shadow duration-200 hover:shadow-md {urgencyClass(item)}"
          data-testid="compliance-milestone"
        >
          <div>
            <div class="font-heading font-medium text-slate-900">{item.milestoneName}</div>
            <div class="text-xs font-mono text-slate-500">{item.contractNumber}</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
              {statusLabel(item.status)}
            </span>
            <span class="text-sm font-mono text-slate-700">{formatDate(item.dueDate)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
