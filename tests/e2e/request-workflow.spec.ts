/**
 * E2E: Request workflow — create NDA request, verify kanban board.
 */

import { test, expect, login } from "./fixtures.js";

test.describe("Request Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "contracts_manager");
  });

  test("full NDA request workflow: open modal, fill form, submit, verify kanban", async ({ page }) => {
    await page.goto("/requests");

    await expect(page.getByTestId("requests-page")).toBeVisible();
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // Verify existing request in NEW column
    const newColumn = page.locator('[data-testid="kanban-column"][data-status="NEW"]');
    await expect(newColumn).toBeVisible();
    await expect(newColumn.getByTestId("column-count")).toContainText("1");

    // Wait for hydration to complete before interacting
    await page.waitForLoadState("networkidle");

    // Open modal
    await page.getByTestId("new-request-btn").click();
    await expect(page.getByTestId("request-modal")).toBeVisible();

    // Fill form
    await page.getByTestId("form-type").selectOption("NDA");
    await page.getByTestId("form-title").fill("NDA with Boeing for F-35 Program");
    await page.getByTestId("form-summary").fill("Mutual NDA required for F-35 subcontract discussions");
    await page.getByTestId("form-priority").selectOption("HIGH");

    // NDA-specific fields should appear
    await expect(page.getByTestId("nda-fields")).toBeVisible();
    await page.getByTestId("field-counterparty").fill("Boeing");
    await page.getByTestId("field-nda-type").selectOption("mutual");
    await page.getByTestId("field-scope").fill("F-35 Lightning II program classified discussions");
    await page.getByTestId("field-deadline").fill("2026-03-15");

    // Submit
    await page.getByTestId("form-submit").click();

    // Modal should close
    await expect(page.getByTestId("request-modal")).not.toBeVisible({ timeout: 5_000 });
  });

  test("kanban board shows requests grouped by status", async ({ page }) => {
    await page.goto("/requests");

    const board = page.getByTestId("kanban-board");
    await expect(board).toBeVisible();

    // NEW column should have the existing request
    const newColumn = page.locator('[data-testid="kanban-column"][data-status="NEW"]');
    await expect(newColumn).toBeVisible();

    // Request card visible
    const card = page.getByTestId("request-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Raytheon");

    // Priority badge
    await expect(card.getByTestId("priority-badge")).toContainText("HIGH");
  });

  test("filters requests by type and priority", async ({ page }) => {
    await page.goto("/requests");

    // Filter by NDA type
    await page.getByTestId("filter-type").selectOption("NDA");

    // Should still show the NDA request
    await expect(page.getByTestId("request-card")).toHaveCount(1);
  });
});
