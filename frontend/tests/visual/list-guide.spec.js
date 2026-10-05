import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

test.beforeEach(async ({ page }) => openDashboard(page));

test("how this list works opens under the list and explains its words", async ({ page, isMobile }) => {
  const toggle = page.getByRole("button", { name: "How this list works" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const guide = page.locator(".guide-section");
  await expect(guide.getByText("A cancelled plan whose paid time is over.", { exact: false })).toBeVisible();
  await expect(guide.getByText("does not cancel it with the provider", { exact: false })).toBeVisible();
  // The keys only where there is a keyboard to press them.
  await expect(guide.getByRole("definition").filter({ hasText: "Add a subscription" })).toHaveCount(isMobile ? 0 : 1);

  if (!isMobile) {
    await guide.scrollIntoViewIfNeeded();
    await expect(guide).toHaveScreenshot("list-guide-open.png");
  }
});
