<script lang="ts">
  import type { ContractOption } from "$lib/types.js";
  import { formatCurrency, formatDate, daysUntil, statusColor, statusLabel } from "$lib/format.js";

  export let options: ContractOption[];
</script>

<div data-testid="options-tab">
  {#if options.length === 0}
    <p class="text-sm font-body text-slate-400">No option periods found</p>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each options as opt (opt.id)}
        <div class="border border-slate-300 bg-white rounded-lg shadow-sm p-4 transition-shadow duration-200 hover:shadow-md" data-testid="option-card">
          <div class="flex items-center justify-between">
            <span class="text-sm font-heading font-semibold text-slate-900">Option {opt.optionNumber}</span>
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(opt.status)}">
              {statusLabel(opt.status)}
            </span>
          </div>

          <dl class="mt-3 space-y-2 text-sm font-body">
            <div class="flex justify-between">
              <dt class="text-slate-500">Value</dt>
              <dd class="font-medium font-dramatic">{formatCurrency(opt.optionValue)}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Period</dt>
              <dd class="font-mono text-slate-700">{formatDate(opt.optionStart)} — {formatDate(opt.optionEnd)}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Exercise Deadline</dt>
              <dd class="font-medium font-mono">{formatDate(opt.exerciseDeadline)}</dd>
            </div>
          </dl>

          {#if opt.status === "PENDING"}
            {@const days = daysUntil(opt.exerciseDeadline)}
            <div class="mt-3 rounded px-2 py-1 text-center text-xs font-medium font-body
              {days < 0 ? 'bg-red-100 text-red-700' : days <= 30 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}"
              data-testid="countdown"
            >
              {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days remaining`}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
