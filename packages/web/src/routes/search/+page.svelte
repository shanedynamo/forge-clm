<script lang="ts">
  import type { SearchResult, AskResponse, Citation, ContractSummary } from "$lib/types.js";

  // ─── Props for testability (override internal state) ────────────
  export let initialMode: "search" | "ask" = "search";
  export let initialResults: SearchResult[] | null = null;
  export let initialAnswer: AskResponse | null = null;
  export let initialLoading: boolean = false;
  export let initialQuery: string = "";
  export let contracts: ContractSummary[] = [];

  // ─── Internal state ─────────────────────────────────────────────
  let mode: "search" | "ask" = initialMode;
  let query = initialQuery;
  let loading = initialLoading;
  let results: SearchResult[] | null = initialResults;
  let answer: AskResponse | null = initialAnswer;
  let error: string | null = null;

  // Filters
  let filterContractId = "";
  let filterSectionType = "";
  let filterDateFrom = "";
  let filterDateTo = "";

  // Ask mode
  let scopeContractId = "";

  // Citation expansion
  let expandedCitationIdx: number | null = null;

  const SECTION_TYPES = ["clause", "deliverable", "modification", "option", "communication"];

  function confidenceLabel(score: number): { text: string; color: string } {
    if (score >= 0.8) return { text: "High", color: "bg-green-100 text-green-700" };
    if (score >= 0.5) return { text: "Medium", color: "bg-amber-100 text-amber-700" };
    return { text: "Low", color: "bg-red-100 text-red-700" };
  }

  async function handleSubmit() {
    if (!query.trim()) return;
    loading = true;
    error = null;
    results = null;
    answer = null;

    try {
      const apiBase = "http://localhost:3000/api/v1";
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (mode === "search") {
        const body: Record<string, string> = { query };
        if (filterContractId) body.contractId = filterContractId;
        if (filterSectionType) body.sectionType = filterSectionType;
        if (filterDateFrom) body.dateFrom = filterDateFrom;
        if (filterDateTo) body.dateTo = filterDateTo;

        const res = await fetch(`${apiBase}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Search request failed");
        results = await res.json();
      } else {
        const body: Record<string, string> = { question: query };
        if (scopeContractId) body.contract_id = scopeContractId;

        const res = await fetch(`${apiBase}/ask`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Ask request failed");
        answer = await res.json();
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "An error occurred";
    } finally {
      loading = false;
    }
  }

  function toggleCitation(idx: number) {
    expandedCitationIdx = expandedCitationIdx === idx ? null : idx;
  }
</script>

<div data-testid="search-page">
  <!-- Mode Toggle -->
  <div class="mb-6 flex items-center gap-4">
    <div class="inline-flex rounded-lg border border-gray-200 bg-white p-1">
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors
          {mode === 'search' ? 'bg-navy-800 text-white' : 'text-gray-600 hover:text-gray-900'}"
        on:click={() => { mode = "search"; results = null; answer = null; }}
        data-testid="mode-search"
      >
        Search
      </button>
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors
          {mode === 'ask' ? 'bg-navy-800 text-white' : 'text-gray-600 hover:text-gray-900'}"
        on:click={() => { mode = "ask"; results = null; answer = null; }}
        data-testid="mode-ask"
      >
        Ask AI
      </button>
    </div>
    <span class="text-sm text-gray-500">
      {mode === "search" ? "Search across contract documents" : "Ask questions about your contracts"}
    </span>
  </div>

  <!-- Search Input -->
  <form on:submit|preventDefault={handleSubmit} class="mb-6" data-testid="search-form">
    <div class="relative">
      <input
        bind:value={query}
        type="text"
        placeholder={mode === "search"
          ? "Search contract clauses, deliverables, modifications..."
          : "Ask a question about your contracts..."}
        class="w-full rounded-xl border border-gray-300 bg-white py-4 pl-12 pr-32 text-lg shadow-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
        data-testid="search-input"
      />
      <svg class="absolute left-4 top-5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <button
        type="submit"
        class="absolute right-3 top-3 rounded-lg bg-navy-800 px-5 py-2 text-sm font-medium text-white hover:bg-navy-700"
        data-testid="search-submit"
      >
        {mode === "search" ? "Search" : "Ask"}
      </button>
    </div>
  </form>

  <div class="flex gap-6">
    <!-- Filters Sidebar (Search mode only) -->
    {#if mode === "search"}
      <aside class="hidden w-56 shrink-0 lg:block" data-testid="search-filters">
        <div class="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700">Filters</h3>

          <div>
            <label for="filter-contract" class="block text-xs font-medium text-gray-600">Contract</label>
            <select
              id="filter-contract"
              bind:value={filterContractId}
              class="mt-1 w-full rounded border-gray-300 text-sm"
              data-testid="filter-contract"
            >
              <option value="">All contracts</option>
              {#each contracts as c}
                <option value={c.id}>{c.contractNumber}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="filter-section" class="block text-xs font-medium text-gray-600">Section Type</label>
            <select
              id="filter-section"
              bind:value={filterSectionType}
              class="mt-1 w-full rounded border-gray-300 text-sm"
              data-testid="filter-section-type"
            >
              <option value="">All types</option>
              {#each SECTION_TYPES as s}
                <option value={s}>{s}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="filter-from" class="block text-xs font-medium text-gray-600">Date From</label>
            <input
              id="filter-from"
              type="date"
              bind:value={filterDateFrom}
              class="mt-1 w-full rounded border-gray-300 text-sm"
              data-testid="filter-date-from"
            />
          </div>

          <div>
            <label for="filter-to" class="block text-xs font-medium text-gray-600">Date To</label>
            <input
              id="filter-to"
              type="date"
              bind:value={filterDateTo}
              class="mt-1 w-full rounded border-gray-300 text-sm"
              data-testid="filter-date-to"
            />
          </div>
        </div>
      </aside>
    {/if}

    <!-- Results Area -->
    <div class="min-w-0 flex-1">
      <!-- Loading State -->
      {#if loading}
        <div class="space-y-4" data-testid="loading-skeletons">
          {#each [1, 2, 3] as _}
            <div class="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div class="mb-3 h-4 w-1/3 rounded bg-gray-200"></div>
              <div class="mb-2 h-3 w-full rounded bg-gray-100"></div>
              <div class="mb-2 h-3 w-5/6 rounded bg-gray-100"></div>
              <div class="h-3 w-2/3 rounded bg-gray-100"></div>
            </div>
          {/each}
        </div>

      <!-- Error -->
      {:else if error}
        <div class="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700" data-testid="error-message">
          {error}
        </div>

      <!-- Search Results -->
      {:else if mode === "search" && results !== null}
        {#if results.length === 0}
          <div class="rounded-lg border border-gray-200 bg-white p-8 text-center" data-testid="empty-results">
            <svg class="mx-auto mb-3 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 class="text-sm font-medium text-gray-900">No results found</h3>
            <p class="mt-2 text-sm text-gray-500" data-testid="suggestions">
              Try broadening your search terms, removing filters, or searching for specific clause numbers like "52.219-8"
            </p>
          </div>
        {:else}
          <div class="space-y-3" data-testid="search-results">
            {#each results as result (result.id)}
              <a
                href="/contracts/{result.contractId}?tab=clauses{result.clauseNumber ? `&clause=${result.clauseNumber}` : ''}"
                class="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-navy-300 hover:bg-navy-50"
                data-testid="search-result"
              >
                <div class="mb-2 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-navy-800">{result.contractNumber}</span>
                    {#if result.clauseNumber}
                      <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                        {result.clauseNumber}
                      </span>
                    {/if}
                    <span class="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                      {result.sectionType}
                    </span>
                  </div>
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-medium
                      {result.similarity >= 0.8 ? 'bg-green-100 text-green-700' :
                       result.similarity >= 0.5 ? 'bg-amber-100 text-amber-700' :
                       'bg-gray-100 text-gray-600'}"
                    data-testid="similarity-score"
                  >
                    {Math.round(result.similarity * 100)}% match
                  </span>
                </div>
                <p class="text-sm leading-relaxed text-gray-700" data-testid="chunk-text">
                  {result.chunkText}
                </p>
              </a>
            {/each}
          </div>
        {/if}

      <!-- Ask Response -->
      {:else if mode === "ask" && answer !== null}
        <div class="space-y-4" data-testid="ask-response">
          <!-- Confidence Indicator -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">Confidence:</span>
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {confidenceLabel(answer.confidence).color}"
              data-testid="confidence-indicator"
            >
              {confidenceLabel(answer.confidence).text} ({Math.round(answer.confidence * 100)}%)
            </span>
          </div>

          <!-- Answer -->
          <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="ai-answer">
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">
                AI
              </div>
              <span class="text-xs font-medium text-gray-500">Forge Intelligence</span>
            </div>
            <div class="prose prose-sm max-w-none text-gray-800">
              <p>{answer.answer}</p>
            </div>
          </div>

          <!-- Citations -->
          {#if answer.citations.length > 0}
            <div data-testid="citations-section">
              <h3 class="mb-2 text-sm font-semibold text-gray-700">
                Sources ({answer.citations.length})
              </h3>
              <div class="space-y-2">
                {#each answer.citations as citation, idx}
                  <div class="rounded-lg border border-gray-200 bg-white shadow-sm" data-testid="citation">
                    <button
                      class="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50"
                      on:click={() => toggleCitation(idx)}
                      data-testid="citation-toggle"
                    >
                      <div class="flex items-center gap-2">
                        <a
                          href="/contracts/{citation.contractId}"
                          class="font-medium text-navy-800 hover:underline"
                          on:click|stopPropagation
                          data-testid="citation-link"
                        >
                          {citation.contractNumber}
                        </a>
                        {#if citation.clauseNumber}
                          <span class="font-mono text-xs text-gray-500">{citation.clauseNumber}</span>
                        {/if}
                        <span class="text-xs text-gray-400">{citation.sectionType}</span>
                      </div>
                      <span class="text-xs text-gray-500">{Math.round(citation.relevance * 100)}% relevance</span>
                    </button>

                    {#if expandedCitationIdx === idx}
                      <div class="border-t border-gray-100 px-4 py-3" data-testid="citation-source-text">
                        <p class="text-sm text-gray-600">{citation.chunkText}</p>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

      <!-- Ask mode empty results -->
      {:else if mode === "ask" && answer !== null && !answer.answer}
        <div class="rounded-lg border border-gray-200 bg-white p-8 text-center" data-testid="empty-results">
          <h3 class="text-sm font-medium text-gray-900">No answer found</h3>
          <p class="mt-2 text-sm text-gray-500" data-testid="suggestions">
            Try rephrasing your question or scoping it to a specific contract for better results
          </p>
        </div>
      {/if}
    </div>

    <!-- Contract Scope (Ask mode) -->
    {#if mode === "ask"}
      <aside class="hidden w-56 shrink-0 lg:block" data-testid="ask-sidebar">
        <div class="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h3 class="text-sm font-semibold text-gray-700">Scope</h3>
          <div>
            <label for="scope-contract" class="block text-xs font-medium text-gray-600">Contract</label>
            <select
              id="scope-contract"
              bind:value={scopeContractId}
              class="mt-1 w-full rounded border-gray-300 text-sm"
              data-testid="scope-contract"
            >
              <option value="">All contracts</option>
              {#each contracts as c}
                <option value={c.id}>{c.contractNumber}</option>
              {/each}
            </select>
          </div>
        </div>
      </aside>
    {/if}
  </div>
</div>
