import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #53: a cancelled plan keeps its access until the time already paid
// for runs out, and until then it belongs in the list like any live plan.
// Only once access has ended does it go grey and move behind "Show ended".
// Today is frozen at 15 Sep 2026 (mocks.js).

const row = (fields) => ({
  group_id: null, cost: "11.99", billing_cycle: "monthly", category: "Work",
  started_date: "2025-01-01", paused_date: null, archived_date: null, paid_total: "0.00",
  ...fields,
});

const fixture = [
  row({ id: 1, name: "Netflix", status: "active", next_renewal_date: "2026-09-20", cancelled_date: null }),
  // Cancelled last week, paid through the end of the month.
  row({ id: 2, name: "Dropbox", status: "cancelled", next_renewal_date: "2026-09-30", cancelled_date: "2026-09-08" }),
  // Access ran out back in July.
  row({ id: 3, name: "Hulu", status: "cancelled", next_renewal_date: "2026-07-01", cancelled_date: "2026-06-10" }),
  // Access ends today, and runs through today.
  row({ id: 4, name: "Figma", status: "cancelled", next_renewal_date: "2026-09-15", cancelled_date: "2026-08-20" }),
];

test.beforeEach(async ({ page }) => {
  await openDashboard(page);
  await page.route("**/subscriptions", (route) => route.fulfill({ json: fixture }));
  await page.reload();
  await page.getByText("Netflix").first().waitFor();
});

const list = (page) => page.locator(".table-section");
const dimmed = (page) => list(page).locator(".row-cancelled, .mobile-row.cancelled");

test("a cancelled plan with access left shows without a filter, in full ink", async ({ page }) => {
  await expect(list(page).getByText("Dropbox")).toBeVisible();
  await expect(list(page).getByText("Figma")).toBeVisible();
  await expect(list(page).getByText("Hulu")).toHaveCount(0);
  await expect(dimmed(page)).toHaveCount(0);
  await expect(list(page).getByText(/access ends/).first()).toBeVisible();
  await expect(list(page).getByText("Cancelled", { exact: true }).first()).toBeVisible();
  // Only the plan that has actually ended waits behind the toggle.
  await expect(list(page).getByRole("button", { name: "Show ended — 1" })).toBeVisible();
});

test("an ended plan is greyed behind Show ended, and only it is archived in bulk", async ({ page }) => {
  const archived = [];
  await page.route("**/subscriptions/*/archive", (route) => {
    archived.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await list(page).getByRole("button", { name: "Show ended — 1" }).click();
  await expect(list(page).getByText("Hulu")).toBeVisible();
  await expect(dimmed(page)).toHaveCount(1);
  await expect(dimmed(page)).toContainText("Hulu");
  await expect(list(page).getByText(/access ended/).first()).toBeVisible();
  await list(page).getByRole("button", { name: "Archive all ended — 1" }).click();
  await expect.poll(() => archived).toEqual([expect.stringMatching(/\/subscriptions\/3\/archive$/)]);
});
