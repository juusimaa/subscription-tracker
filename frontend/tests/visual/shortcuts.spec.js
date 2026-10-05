import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #67: Enter saves the edit row, the view lives in the URL, "/" and
// "n" are shortcuts, and the cancelled list can be archived in one go.
// Desktop only -- the edit row and a keyboard are desktop things, and the
// URL and bulk archive are shared code.
test.skip(({ isMobile }) => isMobile, "desktop only");

const notice = (page) => page.locator(".table-section [role=status]");

test("Enter in the edit row saves it", async ({ page }) => {
  await openDashboard(page);
  const bodies = [];
  await page.route("**/subscriptions/1", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 1 } });
  });
  const row = page.getByRole("row").filter({ hasText: "Netflix" });
  await row.getByRole("button", { name: "Edit" }).click();
  const cost = page.locator(".row-editing").getByRole("textbox", { name: "Cost" });
  await cost.fill("17.99");
  await cost.press("Enter");
  await expect(notice(page)).toHaveText("Netflix saved.");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ cost: 17.99 });
});

test("a bookmarked period, sort and toggle open as they were left", async ({ page }) => {
  await openDashboard(page, "/?view=yearly&year=2025&sort=cost&dir=desc&cancelled=1");
  await expect(page.getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Choose period, currently 2025" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Cost/ })).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("button", { name: "Hide ended" })).toBeVisible();
});

test("changing the view writes it to the URL, and the default stays a plain URL", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(page).toHaveURL(/\?year=2026&month=8$/);
  await page.getByRole("button", { name: "Yearly" }).click();
  await expect(page).toHaveURL(/\?view=yearly&year=2026$/);
  await page.getByRole("button", { name: "Monthly" }).click();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: /Show ended/ }).click();
  await page.getByRole("columnheader", { name: /^Name/ }).getByRole("button").click();
  await expect(page).toHaveURL(/\?sort=name&cancelled=1$/);
});

test("/ focuses search and n goes to the add form", async ({ page }) => {
  await openDashboard(page);
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Search subscriptions" });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  // Typed into the search box, "n" is just a letter.
  await page.keyboard.press("n");
  await expect(search).toHaveValue("n");
  await search.blur();
  await page.keyboard.press("n");
  await expect(page.locator("#add input").first()).toBeFocused();
});

test("archive all ended, and undo it", async ({ page }) => {
  await openDashboard(page);
  const archived = [];
  const unarchived = [];
  await page.route("**/subscriptions/*/archive", (route) => {
    archived.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.route("**/subscriptions/*/unarchive", (route) => {
    unarchived.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  // Only offered while the ended plans are on screen.
  await expect(page.getByRole("button", { name: /Archive all ended/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Show ended/ }).click();
  await page.getByRole("button", { name: "Archive all ended — 1" }).click();
  await expect(notice(page)).toHaveText("Dropbox archived and hidden from the list. Undo");
  expect(archived).toEqual([expect.stringMatching(/\/subscriptions\/5\/archive$/)]);
  await notice(page).getByRole("button", { name: "Undo" }).click();
  await expect(notice(page)).toHaveText("Dropbox is back in the list.");
  expect(unarchived).toEqual([expect.stringMatching(/\/subscriptions\/5\/unarchive$/)]);
});
