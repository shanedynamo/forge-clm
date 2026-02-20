<script lang="ts">
  import type {
    ContractRequest,
    RequestType,
    RequestStatus,
    RequestPriority,
  } from "$lib/types.js";
  import { formatDate, statusLabel } from "$lib/format.js";

  export let data: { requests: ContractRequest[] };

  const COLUMNS: { status: RequestStatus; label: string; color: string }[] = [
    { status: "NEW", label: "New", color: "bg-blue-50 border-blue-200" },
    { status: "IN_PROGRESS", label: "In Progress", color: "bg-amber-50 border-amber-200" },
    { status: "UNDER_REVIEW", label: "Under Review", color: "bg-purple-50 border-purple-200" },
    { status: "COMPLETED", label: "Completed", color: "bg-green-50 border-green-200" },
    { status: "CANCELLED", label: "Cancelled", color: "bg-gray-50 border-gray-200" },
  ];

  const REQUEST_TYPES: RequestType[] = [
    "NDA", "MOU", "NEW_CONTRACT", "MOD", "OPTION_EXERCISE", "FUNDING_ACTION",
  ];

  const PRIORITY_COLORS: Record<RequestPriority, string> = {
    LOW: "bg-gray-100 text-gray-600",
    NORMAL: "bg-blue-100 text-blue-700",
    HIGH: "bg-orange-100 text-orange-700",
    URGENT: "bg-red-100 text-red-700",
  };

  const TYPE_ICONS: Record<RequestType, string> = {
    NDA: "N",
    MOU: "M",
    NEW_CONTRACT: "C",
    MOD: "X",
    OPTION_EXERCISE: "O",
    FUNDING_ACTION: "F",
  };

  // ─── Filters ────────────────────────────────────────────────────
  let filterType: RequestType | "" = "";
  let filterPriority: RequestPriority | "" = "";
  let filterAssignee = "";

  function filteredRequests(
    items: ContractRequest[],
    ft: RequestType | "",
    fp: RequestPriority | "",
    fa: string,
  ): ContractRequest[] {
    return items.filter((r) => {
      if (ft && r.requestType !== ft) return false;
      if (fp && r.priority !== fp) return false;
      if (fa && r.assignedTo !== fa) return false;
      return true;
    });
  }

  function cardsForColumn(
    status: RequestStatus,
    items: ContractRequest[],
    ft: RequestType | "",
    fp: RequestPriority | "",
    fa: string,
  ): ContractRequest[] {
    return filteredRequests(items, ft, fp, fa).filter(
      (r) => r.status === status,
    );
  }

  // ─── Drag and drop ──────────────────────────────────────────────
  let dragId: string | null = null;

  function handleDragStart(id: string) {
    dragId = id;
  }

  function handleDrop(targetStatus: RequestStatus) {
    if (!dragId) return;
    const idx = data.requests.findIndex((r) => r.id === dragId);
    if (idx !== -1 && data.requests[idx]!.status !== targetStatus) {
      data.requests[idx] = { ...data.requests[idx]!, status: targetStatus };
      data = data; // trigger reactivity
    }
    dragId = null;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  // ─── New Request Modal ──────────────────────────────────────────
  let showModal = false;
  let formType: RequestType = "NDA";
  let formTitle = "";
  let formSummary = "";
  let formPriority: RequestPriority = "NORMAL";

  // Dynamic fields
  let ndaCounterparty = "";
  let ndaType: "mutual" | "unilateral" = "mutual";
  let ndaScope = "";
  let ndaDeadline = "";

  let mouParties = "";
  let mouPurpose = "";
  let mouDuration = "";

  let modContractNumber = "";
  let modType = "";
  let modDescription = "";

  let optContractNumber = "";
  let optOptionNumber = "";

  let fundContractNumber = "";
  let fundClin = "";
  let fundAmount = "";
  let fundJustification = "";

  function resetForm() {
    formTitle = "";
    formSummary = "";
    formPriority = "NORMAL";
    ndaCounterparty = "";
    ndaType = "mutual";
    ndaScope = "";
    ndaDeadline = "";
    mouParties = "";
    mouPurpose = "";
    mouDuration = "";
    modContractNumber = "";
    modType = "";
    modDescription = "";
    optContractNumber = "";
    optOptionNumber = "";
    fundContractNumber = "";
    fundClin = "";
    fundAmount = "";
    fundJustification = "";
  }

  function buildMetadata(): Record<string, unknown> {
    switch (formType) {
      case "NDA":
        return { counterparty: ndaCounterparty, ndaType, scope: ndaScope, deadline: ndaDeadline };
      case "MOU":
        return { parties: mouParties, purpose: mouPurpose, duration: mouDuration };
      case "MOD":
        return { contractNumber: modContractNumber, modType, description: modDescription };
      case "OPTION_EXERCISE":
        return { contractNumber: optContractNumber, optionNumber: optOptionNumber };
      case "FUNDING_ACTION":
        return { contractNumber: fundContractNumber, clin: fundClin, amount: fundAmount, justification: fundJustification };
      default:
        return {};
    }
  }

  function handleSubmit() {
    const newReq: ContractRequest = {
      id: `req-${Date.now()}`,
      requestType: formType,
      title: formTitle,
      summary: formSummary,
      priority: formPriority,
      status: "NEW",
      requester: "Current User",
      assignedTo: null,
      submittedAt: new Date().toISOString(),
      metadata: buildMetadata(),
    };
    data.requests = [...data.requests, newReq];
    showModal = false;
    resetForm();
  }
</script>

<div data-testid="requests-page">
  <!-- Header -->
  <div class="mb-6 flex items-center justify-between">
    <h2 class="text-lg font-semibold text-navy-900">Request Queue</h2>
    <div class="flex items-center gap-3">
      <!-- Filters -->
      <select
        bind:value={filterType}
        class="rounded border-gray-300 text-sm"
        data-testid="filter-type"
      >
        <option value="">All Types</option>
        {#each REQUEST_TYPES as t}
          <option value={t}>{statusLabel(t)}</option>
        {/each}
      </select>
      <select
        bind:value={filterPriority}
        class="rounded border-gray-300 text-sm"
        data-testid="filter-priority"
      >
        <option value="">All Priorities</option>
        <option value="LOW">Low</option>
        <option value="NORMAL">Normal</option>
        <option value="HIGH">High</option>
        <option value="URGENT">Urgent</option>
      </select>

      <button
        class="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
        on:click={() => { showModal = true; resetForm(); }}
        data-testid="new-request-btn"
      >
        + New Request
      </button>
    </div>
  </div>

  <!-- Kanban Board -->
  <div class="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
    {#each COLUMNS as col}
      <div
        class="flex w-72 shrink-0 flex-col rounded-lg border {col.color}"
        data-testid="kanban-column"
        data-status={col.status}
        on:drop|preventDefault={() => handleDrop(col.status)}
        on:dragover={handleDragOver}
        role="list"
      >
        <div class="border-b px-3 py-2.5">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold text-gray-700">{col.label}</span>
            <span class="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500" data-testid="column-count">
              {cardsForColumn(col.status, data.requests, filterType, filterPriority, filterAssignee).length}
            </span>
          </div>
        </div>
        <div class="flex-1 space-y-2 p-2" data-testid="column-cards">
          {#each cardsForColumn(col.status, data.requests, filterType, filterPriority, filterAssignee) as req (req.id)}
            <div
              class="cursor-grab rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
              draggable="true"
              on:dragstart={() => handleDragStart(req.id)}
              data-testid="request-card"
              data-request-id={req.id}
              role="listitem"
            >
              <div class="mb-2 flex items-center gap-2">
                <span class="flex h-6 w-6 items-center justify-center rounded bg-navy-100 text-xs font-bold text-navy-700">
                  {TYPE_ICONS[req.requestType] ?? "?"}
                </span>
                <span class="text-sm font-medium text-gray-900 line-clamp-1">{req.title}</span>
              </div>
              <p class="mb-2 text-xs text-gray-500 line-clamp-2">{req.summary}</p>
              <div class="flex items-center justify-between">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium {PRIORITY_COLORS[req.priority]}"
                  data-testid="priority-badge"
                >
                  {req.priority}
                </span>
                <span class="text-xs text-gray-400">{req.requester}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-xs text-gray-400">
                <span>{formatDate(req.submittedAt)}</span>
                {#if req.assignedTo}
                  <span>{req.assignedTo}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- New Request Modal -->
  {#if showModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="request-modal">
      <div class="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-navy-900">New Request</h3>
          <button
            class="text-gray-400 hover:text-gray-600"
            on:click={() => { showModal = false; }}
          >
            &times;
          </button>
        </div>

        <form on:submit|preventDefault={handleSubmit} class="space-y-4" data-testid="request-form">
          <div>
            <label for="req-type" class="block text-sm font-medium text-gray-700">Request Type</label>
            <select id="req-type" bind:value={formType} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="form-type">
              {#each REQUEST_TYPES as t}
                <option value={t}>{statusLabel(t)}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="req-title" class="block text-sm font-medium text-gray-700">Title</label>
            <input id="req-title" bind:value={formTitle} class="mt-1 w-full rounded border-gray-300 text-sm" required data-testid="form-title" />
          </div>

          <div>
            <label for="req-summary" class="block text-sm font-medium text-gray-700">Summary</label>
            <textarea id="req-summary" bind:value={formSummary} rows="2" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="form-summary"></textarea>
          </div>

          <div>
            <label for="req-priority" class="block text-sm font-medium text-gray-700">Priority</label>
            <select id="req-priority" bind:value={formPriority} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="form-priority">
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <!-- Dynamic Fields -->
          <div data-testid="dynamic-fields">
            {#if formType === "NDA"}
              <div class="space-y-3 rounded border border-gray-200 p-3" data-testid="nda-fields">
                <div>
                  <label for="nda-counterparty" class="block text-xs font-medium text-gray-600">Counterparty Name</label>
                  <input id="nda-counterparty" bind:value={ndaCounterparty} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-counterparty" />
                </div>
                <div>
                  <label for="nda-type" class="block text-xs font-medium text-gray-600">NDA Type</label>
                  <select id="nda-type" bind:value={ndaType} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-nda-type">
                    <option value="mutual">Mutual</option>
                    <option value="unilateral">Unilateral</option>
                  </select>
                </div>
                <div>
                  <label for="nda-scope" class="block text-xs font-medium text-gray-600">Scope</label>
                  <input id="nda-scope" bind:value={ndaScope} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-scope" />
                </div>
                <div>
                  <label for="nda-deadline" class="block text-xs font-medium text-gray-600">Deadline</label>
                  <input id="nda-deadline" type="date" bind:value={ndaDeadline} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-deadline" />
                </div>
              </div>
            {:else if formType === "MOU"}
              <div class="space-y-3 rounded border border-gray-200 p-3" data-testid="mou-fields">
                <div>
                  <label for="mou-parties" class="block text-xs font-medium text-gray-600">Parties</label>
                  <input id="mou-parties" bind:value={mouParties} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-parties" />
                </div>
                <div>
                  <label for="mou-purpose" class="block text-xs font-medium text-gray-600">Purpose</label>
                  <input id="mou-purpose" bind:value={mouPurpose} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-purpose" />
                </div>
                <div>
                  <label for="mou-duration" class="block text-xs font-medium text-gray-600">Duration</label>
                  <input id="mou-duration" bind:value={mouDuration} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-duration" />
                </div>
              </div>
            {:else if formType === "MOD"}
              <div class="space-y-3 rounded border border-gray-200 p-3" data-testid="mod-fields">
                <div>
                  <label for="mod-contract" class="block text-xs font-medium text-gray-600">Contract Number</label>
                  <input id="mod-contract" bind:value={modContractNumber} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-contract-number" />
                </div>
                <div>
                  <label for="mod-type" class="block text-xs font-medium text-gray-600">Mod Type</label>
                  <input id="mod-type" bind:value={modType} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-mod-type" />
                </div>
                <div>
                  <label for="mod-desc" class="block text-xs font-medium text-gray-600">Description</label>
                  <textarea id="mod-desc" bind:value={modDescription} rows="2" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-mod-description"></textarea>
                </div>
              </div>
            {:else if formType === "OPTION_EXERCISE"}
              <div class="space-y-3 rounded border border-gray-200 p-3" data-testid="option-fields">
                <div>
                  <label for="opt-contract" class="block text-xs font-medium text-gray-600">Contract Number</label>
                  <input id="opt-contract" bind:value={optContractNumber} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-opt-contract" />
                </div>
                <div>
                  <label for="opt-number" class="block text-xs font-medium text-gray-600">Option Number</label>
                  <input id="opt-number" bind:value={optOptionNumber} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-opt-number" />
                </div>
              </div>
            {:else if formType === "FUNDING_ACTION"}
              <div class="space-y-3 rounded border border-gray-200 p-3" data-testid="funding-fields">
                <div>
                  <label for="fund-contract" class="block text-xs font-medium text-gray-600">Contract Number</label>
                  <input id="fund-contract" bind:value={fundContractNumber} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-fund-contract" />
                </div>
                <div>
                  <label for="fund-clin" class="block text-xs font-medium text-gray-600">CLIN</label>
                  <input id="fund-clin" bind:value={fundClin} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-clin" />
                </div>
                <div>
                  <label for="fund-amount" class="block text-xs font-medium text-gray-600">Amount</label>
                  <input id="fund-amount" bind:value={fundAmount} class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-amount" />
                </div>
                <div>
                  <label for="fund-justification" class="block text-xs font-medium text-gray-600">Justification</label>
                  <textarea id="fund-justification" bind:value={fundJustification} rows="2" class="mt-1 w-full rounded border-gray-300 text-sm" data-testid="field-justification"></textarea>
                </div>
              </div>
            {/if}
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              on:click={() => { showModal = false; }}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700"
              data-testid="form-submit"
            >
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>
