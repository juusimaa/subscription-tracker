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

  await page.getByRole("button", { name: /Show cancelled/ }).first().click();
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
  await page.getByRole("button", { name: /Show cancelled/ }).first().click();

  const mobileRow = page.locator(".mobile-row.cancelled").filter({ hasText: "Dropbox" });
  if (await mobileRow.isVisible()) {
    await mobileRow.click();
    const detail = page.locator(".dialog-detail");
    await expect(detail.getByText("A newer run is already current.")).toBeVisible();
    await expect(detail.getByRole("button", { name: /Reactivate/ })).toHaveCount(0);
  } else {
    const oldRow = page.getByRole("row").filter({ hasText: "Current run exists" });
    await expect(oldRow.getByRole("button", { name: "Current run exists" })).toBeDisabled();
  }
});
