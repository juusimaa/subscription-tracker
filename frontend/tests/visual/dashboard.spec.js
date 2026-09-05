import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

test("dashboard", async ({ page }) => {
  await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
});
