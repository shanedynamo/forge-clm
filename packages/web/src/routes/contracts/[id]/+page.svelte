<script lang="ts">
  import type {
    ContractDetail,
    ContractClause,
    Modification,
    Deliverable,
    ComplianceItem,
    ContractOption,
    Communication,
    FsmTransition,
  } from "$lib/types.js";
  import OverviewTab from "../../../components/contract/OverviewTab.svelte";
  import ClausesTab from "../../../components/contract/ClausesTab.svelte";
  import ModificationsTab from "../../../components/contract/ModificationsTab.svelte";
  import DeliverablesTab from "../../../components/contract/DeliverablesTab.svelte";
  import ComplianceTab from "../../../components/contract/ComplianceTab.svelte";
  import OptionsTab from "../../../components/contract/OptionsTab.svelte";
  import DocumentsTab from "../../../components/contract/DocumentsTab.svelte";
  import CommunicationsTab from "../../../components/contract/CommunicationsTab.svelte";

  export let data: {
    contract: ContractDetail | null;
    clauses: ContractClause[];
    modifications: Modification[];
    deliverables: Deliverable[];
    compliance: ComplianceItem[];
    options: ContractOption[];
    communications: Communication[];
    transitions: FsmTransition[];
  };

  const TABS = [
    "Overview",
    "Clauses",
    "Modifications",
    "Deliverables",
    "Compliance",
    "Options",
    "Documents",
    "Communications",
  ] as const;

  let activeTab: (typeof TABS)[number] = "Overview";

  $: contract = data.contract;
</script>

{#if !contract}
  <div class="text-center text-gray-500 py-12" data-testid="not-found">
    Contract not found
  </div>
{:else}
  <div data-testid="contract-detail">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between">
      <div>
        <div class="flex items-center gap-3">
          <a href="/contracts" class="text-sm text-gray-500 hover:text-navy-700">&larr; Contracts</a>
        </div>
        <h1 class="mt-1 text-2xl font-bold text-navy-900" data-testid="contract-number">
          {contract.contractNumber}
        </h1>
        <p class="mt-1 text-sm text-gray-500">{contract.awardingAgency} &middot; {contract.contractType}</p>
      </div>
      <span
        class="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium
          {contract.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
           contract.status === 'CLOSED' ? 'bg-gray-200 text-gray-600' :
           'bg-blue-100 text-blue-700'}"
        data-testid="contract-status"
      >
        {contract.status.replace(/_/g, " ")}
      </span>
    </div>

    <!-- Tab Navigation -->
    <div class="mb-6 border-b border-gray-200">
      <nav class="-mb-px flex gap-6" data-testid="tab-nav">
        {#each TABS as tab}
          <button
            class="whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors
              {activeTab === tab
                ? 'border-navy-800 text-navy-900'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}"
            on:click={() => (activeTab = tab)}
            data-testid="tab-{tab.toLowerCase()}"
          >
            {tab}
          </button>
        {/each}
      </nav>
    </div>

    <!-- Tab Content -->
    <div data-testid="tab-content">
      {#if activeTab === "Overview"}
        <OverviewTab {contract} transitions={data.transitions} />
      {:else if activeTab === "Clauses"}
        <ClausesTab clauses={data.clauses} />
      {:else if activeTab === "Modifications"}
        <ModificationsTab modifications={data.modifications} />
      {:else if activeTab === "Deliverables"}
        <DeliverablesTab deliverables={data.deliverables} />
      {:else if activeTab === "Compliance"}
        <ComplianceTab compliance={data.compliance} />
      {:else if activeTab === "Options"}
        <OptionsTab options={data.options} />
      {:else if activeTab === "Documents"}
        <DocumentsTab />
      {:else if activeTab === "Communications"}
        <CommunicationsTab communications={data.communications} />
      {/if}
    </div>
  </div>
{/if}
