import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #63: a write that went through says so next to the list, and the
// moves it can take back offer Undo. Desktop only -- the line and the writes
// are shared code, and the inline edit row only exists at this width.
test.skip(({ isMobile }) => isMobile, "desktop table only");

test.beforeEach(async ({ page }) => openDashboard(page));

const notice = (page) => page.locator(".table-section [role=status]");

test("saving a row says so, and stopping an edit is Discard", async ({ page }) => {
  await page.route("**/subscriptions/1", (route) => route.fulfill({ json: { id: 1 } }));
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: "Edit" }).click();
  const editRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Discard" }) });
  await expect(editRow).toBeVisible();
  await expect(editRow.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notice(page)).toHaveText("Netflix saved.");
});

test("converting a trial can be undone", async ({ page }) => {
  const bodies = [];
  await page.route("**/subscriptions/4", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 4 } });
  });
  await page.locator(".trial-banner")
    .getByRole("button", { name: "Convert to paid" }).first().click();
  await expect(notice(page)).toHaveText("Notion converted to paid. Undo");
  await notice(page).getByRole("button", { name: "Undo" }).click();
  await expect(notice(page)).toHaveText("Notion is a trial again.");
  expect(bodies[1]).toMatchObject({ status: "trial" });
});

test("a cancelled plan points to where it went", async ({ page }) => {
  await page.route("**/subscriptions/1", (route) => route.fulfill({ json: { id: 1 } }));
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: /Cancel plan/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel plan" }).click();
  await expect(notice(page)).toHaveText("Netflix cancelled. Show cancelled");
  await notice(page).getByRole("button", { name: "Show cancelled" }).click();
  await expect(page.getByRole("button", { name: "Hide cancelled" })).toBeVisible();
});
