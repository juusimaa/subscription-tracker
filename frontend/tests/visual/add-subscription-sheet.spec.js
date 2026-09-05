import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

// Mobile only: desktop's add form is an always-visible inline section
// (#add), never a dialog -- the sheet only exists once isMobile is true (see
// Dashboard.jsx's focusAddForm), which is also why this file has no desktop
// baseline to keep (playwright.config.js's desktop project doesn't match it).
test("add subscription sheet", async ({ page }) => {
  await page.getByRole("button", { name: "Add subscription" }).click();

  const sheet = page.getByRole("dialog", { name: "Add a subscription" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveScreenshot("add-subscription-sheet.png");
});
