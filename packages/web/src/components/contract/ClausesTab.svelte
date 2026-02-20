<script lang="ts">
  import type { ContractClause } from "$lib/types.js";
  import { riskColor } from "$lib/format.js";

  export let clauses: ContractClause[];

  let expandedId: string | null = null;

  function toggle(id: string) {
    expandedId = expandedId === id ? null : id;
  }
</script>

<div data-testid="clauses-tab">
  {#if clauses.length === 0}
    <p class="text-sm text-gray-400">No clauses found</p>
  {:else}
    <div class="space-y-2">
      {#each clauses as clause (clause.id)}
        <div class="rounded-lg border border-gray-200 bg-white shadow-sm" data-testid="clause-item">
          <button
            class="flex w-full items-center justify-between px-4 py-3 text-left"
            on:click={() => toggle(clause.id)}
          >
            <div class="flex items-center gap-3">
              <span class="font-mono text-sm font-medium text-navy-800">{clause.clauseNumber}</span>
              <span class="text-sm text-gray-700">{clause.clauseTitle}</span>
              <span class="rounded px-1.5 py-0.5 text-xs font-medium {riskColor(clause.riskCategory)}" data-testid="risk-badge">
                {clause.riskCategory ?? "—"}
              </span>
            </div>
            <span class="text-xs text-gray-400">{clause.clauseType}</span>
          </button>

          {#if expandedId === clause.id}
            <div class="border-t border-gray-100 px-4 py-3">
              <pre class="whitespace-pre-wrap text-sm text-gray-600">{clause.fullText}</pre>
              {#if clause.analysisNotes}
                <div class="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
                  <strong>Analysis:</strong> {clause.analysisNotes}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
