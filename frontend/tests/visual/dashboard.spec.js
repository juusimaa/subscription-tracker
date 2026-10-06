import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

test("dashboard", async ({ page }) => {
  await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
});

test("reactivation sends changed terms as a new run", async ({ page }) => {
  let submitted;
  await page.route("**/subscriptions/5/restore", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: 6 } });
  });

  await page.getByRole("button", { name: /Show ended/ }).first().click();
  const mobileRow = page.locator(".mobile-row").filter({ hasText: "Dropbox" });
  if (await mobileRow.isVisible()) {
    await mobileRow.click();
    await page.getByRole("button", { name: /Reactivate/ }).click();
  } else {
    await page.getByRole("row").filter({ hasText: "Dropbox" })
      .getByRole("button", { name: "Reactivate" }).click();
  }

  const dialog = page.getByRole("dialog", { name: "Reactivate Dropbox" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Cost").fill("12.50");
  await dialog.getByLabel("Cycle").selectOption("monthly");
  await dialog.getByLabel("First charge date").fill("2026-10-01");
  await dialog.getByRole("button", { name: "Reactivate" }).click();
  await expect(dialog).not.toBeVisible();
  expect(submitted).toEqual({
    cost: 12.5,
    // Unchanged from the cancelled run unless picked (PLAN.md milestone 10).
    currency: "EUR",
    billing_cycle: "monthly",
    started_date: "2026-10-01",
    next_renewal_date: "2026-10-01",
  });
});

test("an older run cannot be reactivated while a linked run is current", async ({ page }) => {
  await page.route("**/subscriptions", (route) => route.fulfill({ json: [
    {
      id: 5, name: "Dropbox", cost: "150.00", billing_cycle: "yearly",
      status: "cancelled", category: "Work", started_date: "2026-01-01",
      next_renewal_date: "2027-01-01", cancelled_date: "2026-09-01",
      archived_date: null, group_id: 3,
    },
    {
      id: 6, name: "Dropbox", cost: "15.00", billing_cycle: "monthly",
      status: "active", category: "Work", started_date: "2027-01-01",
      next_renewal_date: "2027-01-01", cancelled_date: null,
      archived_date: null, group_id: 3,
    },
  ] }));
  await page.reload();

  // The older run is nested under the current one (issue #49) rather than
  // listed on its own, and it only offers Archive and Delete.
  const toggle = page.locator(".mobile-runs-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.locator(".mobile-earlier .mobile-row").click();
    const detail = page.locator(".dialog-detail");
    await expect(detail.getByRole("button", { name: /Archive/ })).toBeVisible();
    await expect(detail.getByRole("button", { name: /Reactivate/ })).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: "Show 1 earlier run of Dropbox" }).click();
    const oldRow = page.locator(".row-earlier");
    await oldRow.getByRole("button", { name: /More/ }).click();
    await expect(oldRow.getByRole("menuitem", { name: /Archive/ })).toBeVisible();
    await expect(oldRow.getByRole("menuitem", { name: /Reactivate/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Current run exists" })).toHaveCount(0);
  }
});
