import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #49: runs of the same subscription are grouped under the current one.
// The fixtures give Netflix two earlier runs; the oldest is archived.

test.beforeEach(async ({ page }) => openDashboard(page));

const list = (page) => page.locator("#all");
const isMobile = (page) => page.locator(".mobile-list").isVisible();

async function openNetflixGroup(page) {
  if (await isMobile(page)) {
    await page.locator(".mobile-runs-toggle").click();
  } else {
    await page.getByRole("button", { name: "Show 1 earlier run of Netflix" }).click();
  }
}

test("one row per subscription, earlier runs folded away", async ({ page }) => {
  await expect(list(page).getByText("Netflix", { exact: true })).toHaveCount(1);
  await expect(list(page).getByText("1 earlier run").first()).toBeVisible();
  await expect(list(page)).toHaveScreenshot("grouped-runs-collapsed.png");
});

test("an open group shows its earlier runs and lifetime", async ({ page }) => {
  await openNetflixGroup(page);
  await expect(list(page).getByText("Run 2 of 3")).toBeVisible();
  // The archived run stays hidden until Show archived is on.
  await expect(list(page).getByText("Run 1 of 3")).toHaveCount(0);
  await expect(list(page).getByText("€895.35")).toBeVisible();
  await expect(list(page)).toHaveScreenshot("grouped-runs-open.png");

  await page.getByRole("button", { name: /Show archived — 1/ }).click();
  await expect(list(page).getByText("Run 1 of 3")).toBeVisible();
});

test("search opens the group when only an earlier run matches", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Search subscriptions" }).fill("12.99");
  await expect(list(page).getByText("Run 2 of 3")).toBeVisible();
  await expect(list(page).locator(".match")).toHaveCount(1);
});
