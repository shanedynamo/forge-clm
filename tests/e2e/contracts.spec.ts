/**
 * E2E: Contracts list and detail — filtering, tabs, clauses, modifications, transitions.
 */

import { test, expect, login } from "./fixtures.js";

const CONTRACT_ID = "c0000001-0000-0000-0000-000000000001";

test.describe("Contracts", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "contracts_manager");
  });

  test("lists all contracts on /contracts", async ({ page }) => {
    await page.goto("/contracts");

    const rows = page.getByTestId("contract-row");
    await expect(rows).toHaveCount(3);

    // Verify contract numbers are shown
    await expect(page.getByTestId("contract-row").first()).toContainText("FA8726-24-C-0042");
  });

  test("filters contracts by ACTIVE status", async ({ page }) => {
    // Navigate with filter param (equivalent to form submit)
    await page.goto("/contracts?status=ACTIVE");

    // Should show only 2 ACTIVE contracts (FA8726 and N00024)
    await expect(page.getByTestId("contract-row")).toHaveCount(2);

    // Verify the AWARDED contract is excluded
    await expect(page.locator('[data-testid="contracts-page"]')).not.toContainText("W912HZ-25-C-0001");
  });

  test("navigates to contract detail and shows contract info", async ({ page }) => {
    await page.goto(`/contracts/${CONTRACT_ID}`);

    await expect(page.getByTestId("contract-number")).toContainText("FA8726-24-C-0042");
    await expect(page.getByTestId("contract-status")).toContainText("ACTIVE");
  });

  test("shows Clauses tab with clause data", async ({ page }) => {
    await page.goto(`/contracts/${CONTRACT_ID}`);
    await page.waitForLoadState("networkidle");

    // Click Clauses tab
    await page.getByTestId("tab-clauses").click();

    const tabContent = page.getByTestId("tab-content");
    await expect(tabContent).toContainText("52.204-21");
    await expect(tabContent).toContainText("252.227-7013");
    await expect(tabContent).toContainText("Rights in Technical Data");
  });

  test("shows Modifications tab with mod data", async ({ page }) => {
    await page.goto(`/contracts/${CONTRACT_ID}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("tab-modifications").click();

    const tabContent = page.getByTestId("tab-content");
    await expect(tabContent).toContainText("P00001");
    await expect(tabContent).toContainText("P00002");
    await expect(tabContent).toContainText("Incremental funding increase");
  });

  test("shows FSM transition buttons on overview tab", async ({ page }) => {
    await page.goto(`/contracts/${CONTRACT_ID}`);

    // Overview tab is default — should show transitions
    await expect(page.getByTestId("tab-content")).toContainText("CLOSEOUT");
  });
});
