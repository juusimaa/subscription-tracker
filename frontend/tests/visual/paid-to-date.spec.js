import { expect, test } from "@playwright/test";
import { openDashboard, subscriptions } from "./mocks";

// Issue #88: every row says what the service has cost so far -- the whole
// group's paid_total, summed. Netflix's three runs in the fixtures come to
// €527.67 + €207.84 + €159.84 = €895.35.

test.beforeEach(async ({ page }) => openDashboard(page));

const list = (page) => page.locator("#all");

// Head rows only, top to bottom: earlier runs travel with their group.
async function rowNames(page, isMobile) {
  const names = isMobile
    ? list(page).locator(".mobile-list > .mobile-row .mobile-row-name")
    : list(page).locator(".table tbody tr:not(.row-earlier):not(.row-lifetime) .name-stack > span:first-child");
  return names.allTextContents();
}

async function sortByPaid(page, isMobile) {
  if (isMobile) await page.locator(".sort-chip", { hasText: "Paid" }).click();
  else await page.getByRole("button", { name: "Paid to date" }).click();
}

test("a grouped service shows what every run has cost", async ({ page, isMobile }) => {
  const total = isMobile
    ? list(page).locator(".mobile-row-paid").filter({ hasText: "€895.35" })
    : list(page).locator("td").filter({ hasText: "€895.35" });
  await expect(total).toContainText(isMobile ? "paid since Mar 2020" : "3 runs since Mar 2020");
  // A trial says why it is zero rather than showing a bare €0.00.
  await expect(list(page).getByText(isMobile ? "Nothing paid yet" : "free trial, nothing charged")).toBeVisible();
});

test("Paid sorts most first, and an unknown figure always goes last", async ({ page, isMobile }) => {
  // A row restored from an old backup: no start date, so no honest total.
  const gym = { ...subscriptions.find((r) => r.name === "Spotify"), id: 99, name: "Gym", started_date: null, paid_total: null };
  await page.route("**/subscriptions", (route) => route.fulfill({ json: [...subscriptions, gym] }));
  await page.reload();
  await page.getByText("Gym").first().waitFor();
  await expect(list(page).getByText(isMobile ? "Paid to date unknown" : "start date unknown")).toBeVisible();

  await sortByPaid(page, isMobile);
  expect(await rowNames(page, isMobile)).toEqual(["Netflix", "Adobe Creative Cloud", "Spotify", "Notion", "Gym"]);
  await expect(page).toHaveURL(/sort=paid&dir=desc/);

  await sortByPaid(page, isMobile);
  expect(await rowNames(page, isMobile)).toEqual(["Notion", "Spotify", "Adobe Creative Cloud", "Netflix", "Gym"]);
});

test("search finds a service by what it has cost", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Search subscriptions" }).fill("895");
  await expect(list(page).getByRole("heading")).toContainText("1 of");
});
