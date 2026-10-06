import { expect, test } from "@playwright/test";
import { expectBottomSheet, openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

// Mobile only: desktop's add form is an always-visible inline section
// (#add), never a dialog -- the sheet only exists once isMobile is true (see
// Dashboard.jsx's focusAddForm), which is also why this file has no desktop
// baseline to keep (playwright.config.js's desktop project doesn't match it).
//
// The golden is the whole viewport, not the sheet element: an element
// screenshot crops to the sheet itself, so it went on passing while a stray
// fixed width rendered the sheet as an inset panel floating over the
// dashboard instead of a bottom sheet. The viewport capture shows where the
// sheet sits, and expectBottomSheet() says so in numbers.
test("add subscription sheet", async ({ page }) => {
  await page.getByRole("button", { name: "Add subscription" }).click();

  const sheet = page.getByRole("dialog", { name: "Add a subscription" });
  await expect(sheet).toBeVisible();
  await expectBottomSheet(page, sheet);
  await expect(page).toHaveScreenshot("add-subscription-sheet.png");
});
