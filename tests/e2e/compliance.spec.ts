/**
 * E2E: Compliance — summary cards, calendar, overdue table, funding bars.
 */

import { test, expect, login } from "./fixtures.js";

test.describe("Compliance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "contracts_manager");
  });

  test("shows summary cards with correct counts", async ({ page }) => {
    await page.goto("/compliance");
    await expect(page.getByTestId("compliance-page")).toBeVisible();

    const cards = page.getByTestId("summary-cards");
    await expect(cards).toBeVisible();

    // Due this week: 1 (CPARS Review)
    await expect(page.getByTestId("card-due-this-week")).toContainText("1");

    // Overdue: 1 (DCAA Audit)
    await expect(page.getByTestId("card-overdue")).toContainText("1");

    // Option windows: 1
    await expect(page.getByTestId("card-option-windows")).toContainText("1");

    // Ceiling alerts: 1 (W912HZ at 87.5%)
    await expect(page.getByTestId("card-ceiling-alerts")).toContainText("1");
  });

  test("displays calendar with deadline markers", async ({ page }) => {
    await page.goto("/compliance");

    await expect(page.getByTestId("calendar-section")).toBeVisible();
    await expect(page.getByTestId("calendar-grid")).toBeVisible();

    // Calendar should have deadline markers
    const markers = page.getByTestId("deadline-marker");
    await expect(markers.first()).toBeVisible();
  });

  test("shows overdue items table with days overdue", async ({ page }) => {
    await page.goto("/compliance");

    const overdueSection = page.getByTestId("overdue-section");
    await expect(overdueSection).toBeVisible();

    const rows = page.getByTestId("overdue-row");
    await expect(rows).toHaveCount(1);

    // Days overdue value
    await expect(page.getByTestId("days-overdue").first()).toContainText("3");

    // Row contains contract number
    await expect(rows.first()).toContainText("FA8726-24-C-0042");
  });

  test("shows funding percentage bars", async ({ page }) => {
    await page.goto("/compliance");

    const fundingSection = page.getByTestId("funding-section");
    await expect(fundingSection).toBeVisible();

    const fundingRows = page.getByTestId("funding-row");
    await expect(fundingRows).toHaveCount(3);

    // Verify bars and percentages exist
    await expect(page.getByTestId("funding-bar").first()).toBeVisible();
    await expect(page.getByTestId("funding-percent").first()).toBeVisible();
  });
});
