/**
 * E2E: Login flow — credentials, redirect, and auth guard.
 */

import { test, expect, login } from "./fixtures.js";

test.describe("Login", () => {
  test("navigates to /login, enters credentials, verifies redirect to dashboard with user info", async ({ page }) => {
    await page.goto("/login");

    // Login form is visible
    await expect(page.locator("h1")).toContainText("Forge CLM");

    // Fill credentials and select role
    await page.locator("#email").fill("developer@dynamo.com");
    await page.locator("#password").fill("dev-password");
    await page.locator("#role").selectOption("contracts_manager");
    await page.locator('button[type="submit"]').click();

    // Redirected to dashboard
    await page.waitForURL("/");

    // User info shown in top bar
    await expect(page.getByTestId("user-info")).toContainText("developer");
  });

  test("unauthenticated access redirects to /login", async ({ page }) => {
    await page.goto("/contracts");
    await page.waitForURL(/\/login/);
    await expect(page.locator("h1")).toContainText("Forge CLM");
  });

  test("login with different roles displays correct role", async ({ page }) => {
    await login(page, "admin");
    await expect(page.getByTestId("user-info")).toContainText("developer");
  });
});
