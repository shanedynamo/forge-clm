/**
 * E2E: Dashboard — metrics, compliance status, activity feed, quick actions.
 */

import { test, expect, login } from "./fixtures.js";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "contracts_manager");
  });

  test("displays metric cards with correct values", async ({ page }) => {
    const metricsSection = page.getByTestId("metrics-section");
    await expect(metricsSection).toBeVisible();

    await expect(page.getByTestId("metric-active-contracts")).toContainText("12");
    await expect(page.getByTestId("metric-total-ceiling")).toContainText("$45,000,000");
    await expect(page.getByTestId("metric-total-funded")).toContainText("$32,000,000");
    await expect(page.getByTestId("metric-pending-actions")).toContainText("7");
  });

  test("shows compliance section with overdue and upcoming items", async ({ page }) => {
    const compliance = page.getByTestId("compliance-section");
    await expect(compliance).toBeVisible();

    // Overdue items
    await expect(page.getByTestId("overdue-item").first()).toContainText("DCAA Audit");
    await expect(page.getByTestId("overdue-item").first()).toContainText("FA8726-24-C-0042");

    // Due this week
    await expect(page.getByTestId("compliance-item").first()).toContainText("CPARS Review");
  });

  test("shows activity feed with events", async ({ page }) => {
    const activity = page.getByTestId("activity-section");
    await expect(activity).toBeVisible();

    const events = page.getByTestId("activity-event");
    await expect(events).toHaveCount(4);
  });

  test("quick action 'New NDA' navigates to requests page", async ({ page }) => {
    await page.getByTestId("action-new-nda").click();
    await page.waitForURL(/\/requests/);
  });
});
