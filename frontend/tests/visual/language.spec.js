import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #89: the interface speaks English or Finnish, defaulting to the
// browser's preference, and the choice made in the Account dialog sticks.
// Behaviour rather than screenshots: every other spec pins English (see
// playwright.config.js), and one Finnish assertion per surface says more
// here than a second set of baselines would.

test.describe("browser prefers Finnish", () => {
  test.use({ locale: "fi-FI" });

  test("the dashboard opens in Finnish, with Finnish money and dates", async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "fi");
    await expect(page.getByRole("link", { name: "Kaikki tilaukset" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
    // Netflix, 15.99 a month: decimal comma, euro sign after the figure.
    await expect(page.getByText("15,99 €").first()).toBeVisible();
  });

  test("switching to English in the Account dialog sticks across a reload", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /^Tili/ }).click();
    const dialog = page.getByRole("dialog", { name: "Tili" });
    await dialog.getByRole("button", { name: "English" }).click();

    // The dialog stays open through the switch: nothing remounts.
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "All subscriptions" })).toBeVisible();

    await page.reload();
    await page.getByText("Netflix").first().waitFor();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "All subscriptions" })).toBeVisible();
  });

  test("the sign-in screen offers the choice before signing in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Kirjaudu sisään" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });
});

test.describe("browser prefers neither language", () => {
  test.use({ locale: "sv-SE" });

  test("falls back to English", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });
});
