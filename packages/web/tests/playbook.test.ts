import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import PlaybookPage from "../src/routes/playbook/+page.svelte";
import type { PlaybookRule } from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_RULES: PlaybookRule[] = [
  {
    id: "rule-1",
    name: "Small Business Subcontracting",
    type: "CLAUSE_REVIEW",
    priority: 1,
    enabled: true,
    conditions: {
      clausePatterns: ["52.219-8", "52.219-9"],
      contractTypes: ["FFP", "CPFF"],
      dollarThreshold: 750000,
      agencyFilters: [],
    },
    standardPosition:
      "Dynamo accepts standard small business clauses without modification.",
    riskIfDeviated: "LOW",
    redlineTemplate: "",
    notes: "Standard FAR clause — rarely negotiated.",
  },
  {
    id: "rule-2",
    name: "Data Rights Protection",
    type: "NEGOTIATION_POSITION",
    priority: 2,
    enabled: true,
    conditions: {
      clausePatterns: ["252.227-7013", "252.227-7014"],
      contractTypes: [],
      dollarThreshold: null,
      agencyFilters: ["USAF", "USN"],
    },
    standardPosition:
      "Dynamo retains unlimited rights to all independently developed technical data.",
    riskIfDeviated: "CRITICAL",
    redlineTemplate:
      "The contractor retains unlimited rights in all technical data developed at private expense.",
    notes: "High-value IP protection — always negotiate.",
  },
  {
    id: "rule-3",
    name: "Limitation of Funds",
    type: "COMPLIANCE_CHECK",
    priority: 3,
    enabled: false,
    conditions: {
      clausePatterns: ["52.232-22"],
      contractTypes: ["CPFF", "CPIF", "CPAF"],
      dollarThreshold: null,
      agencyFilters: [],
    },
    standardPosition:
      "Monitor funding levels and notify CO at 75% threshold.",
    riskIfDeviated: "HIGH",
    redlineTemplate: "",
    notes: "Disabled — monitoring handled by compliance agent.",
  },
];

function makeData(rules = MOCK_RULES) {
  return { data: { rules: [...rules.map((r) => ({ ...r }))] } };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Playbook — Rule list", () => {
  it("renders all rules in the table", () => {
    render(PlaybookPage, { props: makeData() });

    const rows = screen.getAllByTestId("rule-row");
    expect(rows.length).toBe(3);

    const names = screen.getAllByTestId("rule-name");
    expect(names[0]!.textContent).toBe("Small Business Subcontracting");
    expect(names[1]!.textContent).toBe("Data Rights Protection");
    expect(names[2]!.textContent).toBe("Limitation of Funds");

    // Check priority ordering
    const priorities = screen.getAllByTestId("rule-priority");
    expect(priorities[0]!.textContent).toBe("1");
    expect(priorities[1]!.textContent).toBe("2");
    expect(priorities[2]!.textContent).toBe("3");

    // Check risk badges
    const risks = screen.getAllByTestId("rule-risk");
    expect(risks[0]!.textContent?.trim()).toBe("LOW");
    expect(risks[0]!.className).toContain("bg-green");
    expect(risks[1]!.textContent?.trim()).toBe("CRITICAL");
    expect(risks[1]!.className).toContain("bg-red");
  });

  it("opens the editor when clicking a rule", async () => {
    render(PlaybookPage, { props: makeData() });

    // Editor should not be visible initially
    expect(screen.queryByTestId("rule-editor")).toBeNull();

    // Click the first rule
    const rows = screen.getAllByTestId("rule-row");
    await fireEvent.click(rows[0]!);

    // Editor should appear with rule-1 data
    const editor = screen.getByTestId("rule-editor");
    expect(editor).toBeInTheDocument();

    const nameInput = screen.getByTestId("editor-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Small Business Subcontracting");

    const clauseInput = screen.getByTestId(
      "editor-clause-patterns",
    ) as HTMLInputElement;
    expect(clauseInput.value).toBe("52.219-8, 52.219-9");
  });

  it("edits a rule and saves changes", async () => {
    render(PlaybookPage, { props: makeData() });

    // Open editor for rule-2
    const rows = screen.getAllByTestId("rule-row");
    await fireEvent.click(rows[1]!);

    // Change the name
    const nameInput = screen.getByTestId("editor-name") as HTMLInputElement;
    await fireEvent.input(nameInput, {
      target: { value: "Updated Data Rights" },
    });

    // Change risk
    const riskSelect = screen.getByTestId("editor-risk");
    await fireEvent.change(riskSelect, { target: { value: "HIGH" } });

    // Save
    await fireEvent.click(screen.getByTestId("editor-save"));

    // Editor should close
    expect(screen.queryByTestId("rule-editor")).toBeNull();

    // Table should reflect changes
    const updatedNames = screen.getAllByTestId("rule-name");
    expect(updatedNames[1]!.textContent).toBe("Updated Data Rights");

    const updatedRisks = screen.getAllByTestId("rule-risk");
    expect(updatedRisks[1]!.textContent?.trim()).toBe("HIGH");
    expect(updatedRisks[1]!.className).toContain("bg-orange");
  });

  it("creates a new rule", async () => {
    render(PlaybookPage, { props: makeData() });

    // Click "New Rule"
    await fireEvent.click(screen.getByTestId("new-rule-btn"));

    // Editor should open in new mode
    const editor = screen.getByTestId("rule-editor");
    expect(editor).toBeInTheDocument();
    expect(editor.textContent).toContain("New Rule");

    // Fill in the form
    await fireEvent.input(screen.getByTestId("editor-name"), {
      target: { value: "New Compliance Rule" },
    });
    await fireEvent.change(screen.getByTestId("editor-type"), {
      target: { value: "RISK_ASSESSMENT" },
    });
    await fireEvent.input(screen.getByTestId("editor-standard-position"), {
      target: { value: "Standard position text" },
    });

    // Save
    await fireEvent.click(screen.getByTestId("editor-save"));

    // Should now have 4 rules
    const rows = screen.getAllByTestId("rule-row");
    expect(rows.length).toBe(4);

    // New rule should be in the list
    const names = screen.getAllByTestId("rule-name");
    const newRuleName = names.find(
      (n) => n.textContent === "New Compliance Rule",
    );
    expect(newRuleName).toBeTruthy();
  });

  it("toggles enabled/disabled on a rule", async () => {
    render(PlaybookPage, { props: makeData() });

    const toggles = screen.getAllByTestId("toggle-enabled");
    expect(toggles.length).toBe(3);

    // rule-1 is enabled (green)
    expect(toggles[0]!.className).toContain("bg-green");
    // rule-3 is disabled (gray)
    expect(toggles[2]!.className).toContain("bg-gray");

    // Toggle rule-1 off
    await fireEvent.click(toggles[0]!);
    const updatedToggles = screen.getAllByTestId("toggle-enabled");
    expect(updatedToggles[0]!.className).toContain("bg-gray");

    // Toggle rule-3 on
    await fireEvent.click(updatedToggles[2]!);
    const finalToggles = screen.getAllByTestId("toggle-enabled");
    expect(finalToggles[2]!.className).toContain("bg-green");
  });

  it("reorders rules by drag and drop", async () => {
    render(PlaybookPage, { props: makeData() });

    // Initial order: rule-1 (pri=1), rule-2 (pri=2), rule-3 (pri=3)
    const rows = screen.getAllByTestId("rule-row");
    expect(rows[0]!.getAttribute("data-rule-id")).toBe("rule-1");
    expect(rows[2]!.getAttribute("data-rule-id")).toBe("rule-3");

    // Drag rule-3 (index 2) to index 0
    await fireEvent.dragStart(rows[2]!);
    await fireEvent.drop(rows[0]!);

    // New order: rule-3 (pri=1), rule-1 (pri=2), rule-2 (pri=3)
    const reordered = screen.getAllByTestId("rule-row");
    expect(reordered[0]!.getAttribute("data-rule-id")).toBe("rule-3");
    expect(reordered[1]!.getAttribute("data-rule-id")).toBe("rule-1");
    expect(reordered[2]!.getAttribute("data-rule-id")).toBe("rule-2");

    // Priorities should be reassigned
    const priorities = screen.getAllByTestId("rule-priority");
    expect(priorities[0]!.textContent).toBe("1");
    expect(priorities[1]!.textContent).toBe("2");
    expect(priorities[2]!.textContent).toBe("3");
  });
});
