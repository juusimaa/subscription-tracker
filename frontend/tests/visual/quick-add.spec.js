import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #63: a quick-add tile only fills in the form, so focus lands on the
// price it guessed -- the one field left to check before pressing Add.
test("a quick-add tile hands focus to the cost field", async ({ page }) => {
  await openDashboard(page);
  await page.route("**/subscriptions", (route) => route.fulfill({ json: [] }));
  await page.reload();

  await page.locator(".quick-add button").first().click();
  const cost = page.getByRole("textbox", { name: "Cost" });
  await expect(cost).toBeFocused();
  await expect(cost).not.toHaveValue("");
});
