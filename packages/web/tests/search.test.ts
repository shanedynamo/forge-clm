import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SearchPage from "../src/routes/search/+page.svelte";
import type { SearchResult, AskResponse, ContractSummary } from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_RESULTS: SearchResult[] = [
  {
    id: "sr-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    sectionType: "clause",
    clauseNumber: "52.219-8",
    chunkText: "The contractor shall comply with small business subcontracting requirements...",
    similarity: 0.92,
  },
  {
    id: "sr-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    sectionType: "deliverable",
    clauseNumber: null,
    chunkText: "Monthly status report shall include cost performance data...",
    similarity: 0.74,
  },
  {
    id: "sr-3",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    sectionType: "modification",
    clauseNumber: null,
    chunkText: "Incremental funding action for FY25 Q2 operations...",
    similarity: 0.45,
  },
];

const MOCK_ASK_RESPONSE: AskResponse = {
  answer:
    "Based on the contract documents, the small business subcontracting goal is 23% of total contract value. This is defined in FAR 52.219-8 across all active contracts.",
  citations: [
    {
      contractId: "c-1",
      contractNumber: "FA8726-24-C-0042",
      clauseNumber: "52.219-8",
      sectionType: "clause",
      chunkText: "The contractor shall ensure that small business concerns receive 23% of total subcontract value...",
      relevance: 0.95,
    },
    {
      contractId: "c-2",
      contractNumber: "N00024-23-C-5500",
      clauseNumber: "52.219-9",
      sectionType: "clause",
      chunkText: "Small business subcontracting plan shall include goals for small business participation...",
      relevance: 0.78,
    },
  ],
  confidence: 0.87,
};

const MOCK_CONTRACTS: ContractSummary[] = [
  {
    id: "c-1",
    contractNumber: "FA8726-24-C-0042",
    status: "ACTIVE",
    contractType: "FFP",
    ceilingValue: "5000000",
    fundedValue: "3200000",
    awardingAgency: "USAF",
    popStart: "2024-01-15",
    popEnd: "2027-01-14",
  },
];

// ─── Test helpers ─────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

// ─── Search mode tests ────────────────────────────────────────────────

describe("Search page — Search mode", () => {
  it("submits query on form submit", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESULTS),
    });

    render(SearchPage, {
      props: { initialMode: "search", initialQuery: "small business" },
    });

    const input = screen.getByTestId("search-input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("small business");

    const form = screen.getByTestId("search-form");
    await fireEvent.submit(form);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.query).toBe("small business");
  });

  it("displays search results with similarity scores", () => {
    render(SearchPage, {
      props: { initialMode: "search", initialResults: MOCK_RESULTS },
    });

    const results = screen.getAllByTestId("search-result");
    expect(results.length).toBe(3);

    // Check similarity scores
    const scores = screen.getAllByTestId("similarity-score");
    expect(scores[0]!.textContent).toContain("92%");
    expect(scores[1]!.textContent).toContain("74%");
    expect(scores[2]!.textContent).toContain("45%");

    // Check chunk text displayed
    const chunks = screen.getAllByTestId("chunk-text");
    expect(chunks[0]!.textContent).toContain("small business subcontracting");

    // Check contract numbers
    expect(results[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(results[0]!.textContent).toContain("52.219-8");
    expect(results[1]!.textContent).toContain("N00024-23-C-5500");
  });

  it("links results to contract detail page", () => {
    render(SearchPage, {
      props: { initialMode: "search", initialResults: MOCK_RESULTS },
    });

    const results = screen.getAllByTestId("search-result");

    // First result should link to contract c-1 with clause param
    const href0 = results[0]!.getAttribute("href");
    expect(href0).toContain("/contracts/c-1");
    expect(href0).toContain("tab=clauses");
    expect(href0).toContain("clause=52.219-8");

    // Second result (no clause number) should still link to contract
    const href1 = results[1]!.getAttribute("href");
    expect(href1).toContain("/contracts/c-2");
  });

  it("renders filter sidebar with all filter options", () => {
    render(SearchPage, {
      props: {
        initialMode: "search",
        initialResults: [],
        contracts: MOCK_CONTRACTS,
      },
    });

    const filters = screen.getByTestId("search-filters");
    expect(filters).toBeInTheDocument();
    expect(filters.textContent).toContain("Filters");

    expect(screen.getByTestId("filter-contract")).toBeInTheDocument();
    expect(screen.getByTestId("filter-section-type")).toBeInTheDocument();
    expect(screen.getByTestId("filter-date-from")).toBeInTheDocument();
    expect(screen.getByTestId("filter-date-to")).toBeInTheDocument();
  });
});

// ─── Ask mode tests ───────────────────────────────────────────────────

describe("Search page — Ask mode", () => {
  it("displays AI answer in chat-like interface", () => {
    render(SearchPage, {
      props: { initialMode: "ask", initialAnswer: MOCK_ASK_RESPONSE },
    });

    const answerEl = screen.getByTestId("ai-answer");
    expect(answerEl).toBeInTheDocument();
    expect(answerEl.textContent).toContain("small business subcontracting goal is 23%");
    expect(answerEl.textContent).toContain("Forge Intelligence");
  });

  it("shows clickable citations with source text on expand", async () => {
    render(SearchPage, {
      props: { initialMode: "ask", initialAnswer: MOCK_ASK_RESPONSE },
    });

    const citations = screen.getAllByTestId("citation");
    expect(citations.length).toBe(2);

    // Citation shows contract number and relevance
    expect(citations[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(citations[0]!.textContent).toContain("52.219-8");
    expect(citations[0]!.textContent).toContain("95%");

    // Citation links navigate to contract
    const links = screen.getAllByTestId("citation-link");
    expect(links[0]!.getAttribute("href")).toContain("/contracts/c-1");
    expect(links[1]!.getAttribute("href")).toContain("/contracts/c-2");

    // Click to expand citation source text
    const toggles = screen.getAllByTestId("citation-toggle");
    await fireEvent.click(toggles[0]!);

    const sourceText = screen.getByTestId("citation-source-text");
    expect(sourceText).toBeInTheDocument();
    expect(sourceText.textContent).toContain("23% of total subcontract value");
  });

  it("displays confidence indicator with correct level", () => {
    // High confidence (0.87)
    render(SearchPage, {
      props: { initialMode: "ask", initialAnswer: MOCK_ASK_RESPONSE },
    });

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain("High");
    expect(indicator.textContent).toContain("87%");
    expect(indicator.className).toContain("bg-green");
  });

  it("displays Medium confidence for mid-range scores", () => {
    const mediumAnswer: AskResponse = {
      ...MOCK_ASK_RESPONSE,
      confidence: 0.62,
    };
    render(SearchPage, {
      props: { initialMode: "ask", initialAnswer: mediumAnswer },
    });

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator.textContent).toContain("Medium");
    expect(indicator.className).toContain("bg-amber");
  });

  it("displays Low confidence for low scores", () => {
    const lowAnswer: AskResponse = {
      ...MOCK_ASK_RESPONSE,
      confidence: 0.3,
    };
    render(SearchPage, {
      props: { initialMode: "ask", initialAnswer: lowAnswer },
    });

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator.textContent).toContain("Low");
    expect(indicator.className).toContain("bg-red");
  });
});

// ─── Loading & empty states ───────────────────────────────────────────

describe("Search page — States", () => {
  it("renders skeleton placeholders during loading", () => {
    render(SearchPage, {
      props: { initialMode: "search", initialLoading: true },
    });

    const skeletons = screen.getByTestId("loading-skeletons");
    expect(skeletons).toBeInTheDocument();
    // Should have 3 skeleton cards
    const pulseElements = skeletons.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBe(3);
  });

  it("shows suggestions when no results found", () => {
    render(SearchPage, {
      props: { initialMode: "search", initialResults: [] },
    });

    const empty = screen.getByTestId("empty-results");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain("No results found");

    const suggestions = screen.getByTestId("suggestions");
    expect(suggestions).toBeInTheDocument();
    expect(suggestions.textContent).toContain("broadening your search");
    expect(suggestions.textContent).toContain("52.219-8");
  });
});
