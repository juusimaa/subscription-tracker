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

  // Issue #110: "Lopetettu" and "Arkistoitu" are too wide for one line of the
  // Status column, and the wrapped tag used to sit indented under the first.
  test("a wrapped Archived tag lines up under the status tag", async ({ page }) => {
    const row = (fields) => ({
      group_id: null, cost: "22.59", billing_cycle: "monthly", category: "Work",
      started_date: "2025-01-01", paused_date: null, archived_date: null, paid_total: "0.00",
      ...fields,
    });
    // Narrow enough for the Status column to wrap, wide enough to stay a table.
    await page.setViewportSize({ width: 900, height: 900 });
    await openDashboard(page, "/", {
      routes: (page) =>
        page.route("**/subscriptions", (route) =>
          route.fulfill({
            json: [
              row({ id: 1, name: "Netflix", status: "active", next_renewal_date: "2026-09-20", cancelled_date: null }),
              row({
                id: 2, name: "Claude Pro", status: "cancelled", next_renewal_date: "2026-07-01",
                cancelled_date: "2026-06-10", archived_date: "2026-07-15",
              }),
            ],
          }),
        ),
    });
    // An archived plan whose access has ended waits behind both toggles.
    await page.getByRole("button", { name: /^Näytä päättyneet/ }).click();
    await page.getByRole("button", { name: "Näytä arkistoidut — 1" }).click();

    const tags = page.getByRole("row", { name: /Claude Pro/ }).locator(".tag");
    await expect(tags).toHaveText(["Lopetettu", "Arkistoitu"]);
    const [status, archived] = [await tags.nth(0).boundingBox(), await tags.nth(1).boundingBox()];
    expect(archived.y).toBeGreaterThanOrEqual(status.y + status.height);
    expect(archived.x).toBe(status.x);
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
