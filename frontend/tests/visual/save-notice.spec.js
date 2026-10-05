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

test("a cancelled plan says how long it stays in the list", async ({ page }) => {
  // What the server answers: cancelled today, paid through the 20th.
  await page.route("**/subscriptions/1", (route) => route.fulfill({ json: {
    id: 1, status: "cancelled", cancelled_date: "2026-09-15", next_renewal_date: "2026-09-20",
  } }));
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: /Mark as cancelled/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as cancelled" }).click();
  await expect(notice(page)).toHaveText("Netflix marked as cancelled. It stays in the list until access ends 20 Sep 2026.");
});

test("a cancel back-dated past its term points to where it went", async ({ page }) => {
  await page.route("**/subscriptions/1", (route) => route.fulfill({ json: {
    id: 1, status: "cancelled", cancelled_date: "2026-06-01", next_renewal_date: "2026-06-20",
  } }));
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: /Mark as cancelled/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cancelled on").fill("2026-06-01");
  await dialog.getByRole("button", { name: "Mark as cancelled" }).click();
  await expect(notice(page)).toHaveText("Netflix marked as cancelled. Show ended");
  await notice(page).getByRole("button", { name: "Show ended" }).click();
  await expect(page.getByRole("button", { name: "Hide ended" })).toBeVisible();
});

test("the cancel dialog says it only updates records, and when access ends", async ({ page }) => {
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: /Mark as cancelled/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This updates your records only. Cancel with Netflix too");
  // Started 10 Jan 2024, monthly: cancelled on the 15th, paid through 10 Oct.
  await expect(dialog).toContainText("Access runs until 10 Oct 2026");
  await dialog.getByLabel("Cancelled on").fill("2026-06-01");
  await expect(dialog).toContainText("Access ended 10 Jun 2026");
  await expect(dialog.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
});

test("cancelling a trial asks for no date", async ({ page }) => {
  await page.locator(".trial-banner, .trial-row-actions").getByRole("button", { name: "Cancel before it charges" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("To avoid the charge on 25 Sep 2026, cancel the trial with Notion too.");
  await expect(dialog.getByLabel("Cancelled on")).toHaveCount(0);
});
