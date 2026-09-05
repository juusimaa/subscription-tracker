import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

// AccountDialog.jsx is one component on both desktop and mobile -- CSS alone
// re-chromes it from a centered dialog to a bottom sheet at the 760px
// breakpoint (see .account-backdrop in dashboard.css) -- so this runs at
// both viewports (see playwright.config.js's desktop testMatch) rather than
// being mobile-only like the sheets below.
test("account dialog", async ({ page }) => {
  await page.getByRole("button", { name: /^Account/ }).click();

  const dialog = page.getByRole("dialog", { name: "Account" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveScreenshot("account-dialog.png");
});
