/**
 * Shared Playwright fixtures for E2E tests.
 */

import { test as base, type Page } from "@playwright/test";
export { expect } from "@playwright/test";

/**
 * Log in via the /login form.
 * Fills the dev credentials, selects the given role, and waits for
 * redirect to the dashboard (/).
 */
export async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await page.locator("#email").fill("developer@dynamo.com");
  await page.locator("#password").fill("dev-password");
  await page.locator("#role").selectOption(role);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("/", { timeout: 15_000 });
}

/** Fixture that provides a page already logged in as contracts_manager. */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await login(page, "contracts_manager");
    await use(page);
  },
});
