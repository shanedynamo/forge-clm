/**
 * E2E: Search — keyword search with results, Ask AI mode with citations.
 */

import { test, expect, login } from "./fixtures.js";

test.describe("Search", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "contracts_manager");
  });

  test("searches for 'intellectual property rights' and shows results with similarity scores", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByTestId("search-page")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Enter query and search
    await page.getByTestId("search-input").fill("intellectual property rights");
    await page.getByTestId("search-submit").click();

    // Wait for results
    await expect(page.getByTestId("search-results")).toBeVisible();

    // Verify 3 results returned
    const results = page.getByTestId("search-result");
    await expect(results).toHaveCount(3);

    // Verify similarity scores
    const firstScore = page.getByTestId("similarity-score").first();
    await expect(firstScore).toContainText("94%");

    // Verify chunk text
    await expect(page.getByTestId("chunk-text").first()).toContainText("intellectual property rights");
  });

  test("switches to Ask mode and shows AI answer with citations", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    // Switch to Ask mode
    await page.getByTestId("mode-ask").click();

    // Type question and submit
    await page.getByTestId("search-input").fill("What are the IP rights on the SOCOM contract?");
    await page.getByTestId("search-submit").click();

    // Wait for answer
    await expect(page.getByTestId("ask-response")).toBeVisible();

    // Confidence indicator
    await expect(page.getByTestId("confidence-indicator")).toContainText("High");
    await expect(page.getByTestId("confidence-indicator")).toContainText("91%");

    // AI answer text
    await expect(page.getByTestId("ai-answer")).toContainText("DFARS 252.227-7013");

    // Citations section
    await expect(page.getByTestId("citations-section")).toBeVisible();
    const citations = page.getByTestId("citation");
    await expect(citations).toHaveCount(2);

    // Citation link navigates to contract
    const link = page.getByTestId("citation-link").first();
    await expect(link).toContainText("FA8726-24-C-0042");
    await expect(link).toHaveAttribute("href", /\/contracts\//);
  });
});
