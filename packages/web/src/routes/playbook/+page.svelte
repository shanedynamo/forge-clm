<script lang="ts">
  import type { PlaybookRule, RuleType, RuleConditions } from "$lib/types.js";
  import { riskColor } from "$lib/format.js";

  export let data: { rules: PlaybookRule[] };

  const RULE_TYPES: RuleType[] = [
    "CLAUSE_REVIEW", "RISK_ASSESSMENT", "COMPLIANCE_CHECK", "NEGOTIATION_POSITION",
  ];
  const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

  // ─── Editor state ───────────────────────────────────────────────
  let editingRule: PlaybookRule | null = null;
  let isNew = false;

  // ─── Editable form fields ───────────────────────────────────────
  let eName = "";
  let eType: RuleType = "CLAUSE_REVIEW";
  let ePriority = 1;
  let eEnabled = true;
  let eClausePatterns = "";
  let eContractTypes = "";
  let eDollarThreshold = "";
  let eAgencyFilters = "";
  let eStandardPosition = "";
  let eRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
  let eRedlineTemplate = "";
  let eNotes = "";

  function openEditor(rule: PlaybookRule) {
    editingRule = rule;
    isNew = false;
    eName = rule.name;
    eType = rule.type;
    ePriority = rule.priority;
    eEnabled = rule.enabled;
    eClausePatterns = rule.conditions.clausePatterns.join(", ");
    eContractTypes = rule.conditions.contractTypes.join(", ");
    eDollarThreshold = rule.conditions.dollarThreshold?.toString() ?? "";
    eAgencyFilters = rule.conditions.agencyFilters.join(", ");
    eStandardPosition = rule.standardPosition;
    eRisk = rule.riskIfDeviated;
    eRedlineTemplate = rule.redlineTemplate;
    eNotes = rule.notes;
  }

  function openNewRule() {
    isNew = true;
    editingRule = {
      id: "",
      name: "",
      type: "CLAUSE_REVIEW",
      priority: data.rules.length + 1,
      enabled: true,
      conditions: { clausePatterns: [], contractTypes: [], dollarThreshold: null, agencyFilters: [] },
      standardPosition: "",
      riskIfDeviated: "MEDIUM",
      redlineTemplate: "",
      notes: "",
    };
    eName = "";
    eType = "CLAUSE_REVIEW";
    ePriority = data.rules.length + 1;
    eEnabled = true;
    eClausePatterns = "";
    eContractTypes = "";
    eDollarThreshold = "";
    eAgencyFilters = "";
    eStandardPosition = "";
    eRisk = "MEDIUM";
    eRedlineTemplate = "";
    eNotes = "";
  }

  function saveRule() {
    if (!editingRule) return;

    const conditions: RuleConditions = {
      clausePatterns: eClausePatterns ? eClausePatterns.split(",").map((s) => s.trim()) : [],
      contractTypes: eContractTypes ? eContractTypes.split(",").map((s) => s.trim()) : [],
      dollarThreshold: eDollarThreshold ? parseFloat(eDollarThreshold) : null,
      agencyFilters: eAgencyFilters ? eAgencyFilters.split(",").map((s) => s.trim()) : [],
    };

    const updated: PlaybookRule = {
      ...editingRule,
      id: isNew ? `rule-${Date.now()}` : editingRule.id,
      name: eName,
      type: eType,
      priority: ePriority,
      enabled: eEnabled,
      conditions,
      standardPosition: eStandardPosition,
      riskIfDeviated: eRisk,
      redlineTemplate: eRedlineTemplate,
      notes: eNotes,
    };

    if (isNew) {
      data.rules = [...data.rules, updated];
    } else {
      data.rules = data.rules.map((r) => (r.id === updated.id ? updated : r));
    }

    editingRule = null;
  }

  // ─── Toggle enabled ─────────────────────────────────────────────
  function toggleEnabled(rule: PlaybookRule) {
    data.rules = data.rules.map((r) =>
      r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
    );
  }

  // ─── Priority reorder ──────────────────────────────────────────
  let dragIdx: number | null = null;

  function handleDragStart(idx: number) {
    dragIdx = idx;
  }

  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...data.rules];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved!);
    // Reassign priority numbers
    data.rules = reordered.map((r, i) => ({ ...r, priority: i + 1 }));
    dragIdx = null;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  $: sortedRules = [...data.rules].sort((a, b) => a.priority - b.priority);
</script>

<div data-testid="playbook-page">
  <!-- Header -->
  <div class="mb-6 flex items-center justify-between">
    <h2 class="text-lg font-semibold text-navy-900">Playbook Rules</h2>
    <button
      class="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
      on:click={openNewRule}
      data-testid="new-rule-btn"
    >
      + New Rule
    </button>
  </div>

  <div class="flex gap-6">
    <!-- Rule List -->
    <div class="min-w-0 flex-1">
      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="w-full text-left text-sm" data-testid="rules-table">
          <thead class="border-b border-gray-200 bg-gray-50">
            <tr>
              <th class="w-8 px-3 py-2.5"></th>
              <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">#</th>
              <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Name</th>
              <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Type</th>
              <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Risk</th>
              <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Enabled</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {#each sortedRules as rule, idx (rule.id)}
              <tr
                class="cursor-pointer transition-colors hover:bg-gray-50
                  {editingRule?.id === rule.id ? 'bg-navy-50' : ''}"
                on:click={() => openEditor(rule)}
                draggable="true"
                on:dragstart={() => handleDragStart(idx)}
                on:drop|preventDefault={() => handleDrop(idx)}
                on:dragover={handleDragOver}
                data-testid="rule-row"
                data-rule-id={rule.id}
              >
                <td class="px-3 py-2.5 text-gray-400 cursor-grab">
                  <span data-testid="drag-handle">::</span>
                </td>
                <td class="px-3 py-2.5 text-gray-500" data-testid="rule-priority">{rule.priority}</td>
                <td class="px-3 py-2.5 font-medium text-gray-900" data-testid="rule-name">{rule.name}</td>
                <td class="px-3 py-2.5 text-gray-600">{rule.type.replace(/_/g, " ")}</td>
                <td class="px-3 py-2.5">
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium {riskColor(rule.riskIfDeviated)}" data-testid="rule-risk">
                    {rule.riskIfDeviated}
                  </span>
                </td>
                <td class="px-3 py-2.5" on:click|stopPropagation>
                  <button
                    class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                      {rule.enabled ? 'bg-green-500' : 'bg-gray-300'}"
                    on:click={() => toggleEnabled(rule)}
                    data-testid="toggle-enabled"
                    aria-label="Toggle enabled"
                  >
                    <span
                      class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
                        {rule.enabled ? 'translate-x-4' : 'translate-x-1'}"
                    ></span>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Editor Panel -->
    {#if editingRule}
      <aside class="w-96 shrink-0" data-testid="rule-editor">
        <div class="sticky top-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-navy-900">
              {isNew ? "New Rule" : "Edit Rule"}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              on:click={() => { editingRule = null; }}
            >
              &times;
            </button>
          </div>

          <form on:submit|preventDefault={saveRule} class="space-y-3" data-testid="rule-form">
            <div>
              <label for="e-name" class="block text-xs font-medium text-gray-600">Name</label>
              <input id="e-name" bind:value={eName} class="mt-1 w-full rounded border-gray-300 text-sm" required data-testid="editor-name" />
            </div>
            <div>
              <label for="e-type" class="block text-xs font-medium text-gray-600">Type</label>
              <select id="e-type" bind:value={eType} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-type">
                {#each RULE_TYPES as t}
                  <option value={t}>{t.replace(/_/g, " ")}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="e-priority" class="block text-xs font-medium text-gray-600">Priority</label>
              <input id="e-priority" type="number" bind:value={ePriority} min="1" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-priority" />
            </div>
            <div class="flex items-center gap-2">
              <input id="e-enabled" type="checkbox" bind:checked={eEnabled} class="rounded border-gray-300" data-testid="editor-enabled" />
              <label for="e-enabled" class="text-xs font-medium text-gray-600">Enabled</label>
            </div>

            <!-- Conditions -->
            <fieldset class="rounded border border-gray-200 p-3">
              <legend class="px-1 text-xs font-semibold text-gray-500">Conditions</legend>
              <div class="space-y-2">
                <div>
                  <label for="e-clause" class="block text-xs text-gray-600">Clause Patterns (comma-separated)</label>
                  <input id="e-clause" bind:value={eClausePatterns} placeholder="52.219-*, 252.227-*" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-clause-patterns" />
                </div>
                <div>
                  <label for="e-ctypes" class="block text-xs text-gray-600">Contract Types</label>
                  <input id="e-ctypes" bind:value={eContractTypes} placeholder="FFP, CPFF" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-contract-types" />
                </div>
                <div>
                  <label for="e-threshold" class="block text-xs text-gray-600">Dollar Threshold</label>
                  <input id="e-threshold" bind:value={eDollarThreshold} placeholder="1000000" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-dollar-threshold" />
                </div>
                <div>
                  <label for="e-agencies" class="block text-xs text-gray-600">Agency Filters</label>
                  <input id="e-agencies" bind:value={eAgencyFilters} placeholder="USAF, USN" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-agency-filters" />
                </div>
              </div>
            </fieldset>

            <div>
              <label for="e-position" class="block text-xs font-medium text-gray-600">Standard Position</label>
              <textarea id="e-position" bind:value={eStandardPosition} rows="3" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-standard-position"></textarea>
            </div>
            <div>
              <label for="e-risk" class="block text-xs font-medium text-gray-600">Risk if Deviated</label>
              <select id="e-risk" bind:value={eRisk} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-risk">
                {#each RISK_LEVELS as r}
                  <option value={r}>{r}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="e-redline" class="block text-xs font-medium text-gray-600">Redline Template</label>
              <textarea id="e-redline" bind:value={eRedlineTemplate} rows="3" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-redline"></textarea>
            </div>
            <div>
              <label for="e-notes" class="block text-xs font-medium text-gray-600">Notes</label>
              <textarea id="e-notes" bind:value={eNotes} rows="2" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="editor-notes"></textarea>
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <button
                type="button"
                class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                on:click={() => { editingRule = null; }}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700"
                data-testid="editor-save"
              >
                {isNew ? "Create Rule" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </aside>
    {/if}
  </div>
</div>
