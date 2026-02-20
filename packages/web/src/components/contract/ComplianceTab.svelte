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
    <p class="text-sm text-gray-400">No compliance milestones found</p>
  {:else}
    <div class="space-y-2">
      {#each compliance as item (item.id)}
        <div
          class="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm {urgencyClass(item)}"
          data-testid="compliance-milestone"
        >
          <div>
            <div class="font-medium text-gray-900">{item.milestoneName}</div>
            <div class="text-xs text-gray-500">{item.contractNumber}</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
              {statusLabel(item.status)}
            </span>
            <span class="text-sm text-gray-600">{formatDate(item.dueDate)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
