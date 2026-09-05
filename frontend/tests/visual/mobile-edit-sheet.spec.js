import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

// Regression test for #5: the mobile edit sheet was missing the Started
// field that the desktop inline editor already had, so the start date
// couldn't be changed from mobile.
test("mobile edit sheet shows every field", async ({ page }) => {
  await page.locator(".mobile-row").first().click();

  const sheet = page.locator(".dialog-sheet-edit");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Started", { exact: true })).toBeVisible();
  await expect(sheet).toHaveScreenshot("mobile-edit-sheet.png");
});
