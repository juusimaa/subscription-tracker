import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

// Regression test for #6: the nav's flex children (brand, account button,
// Log out) refused to shrink below their own content width, and with an
// email address in the mix that floor exceeded a phone's viewport, so the
// whole page scrolled sideways instead of just that row.
test("app nav doesn't overflow the viewport", async ({ page }) => {
  await expect(page.locator(".app-nav")).toHaveScreenshot("app-nav.png");

  const [scrollWidth, clientWidth] = await Promise.all([
    page.evaluate(() => document.documentElement.scrollWidth),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
