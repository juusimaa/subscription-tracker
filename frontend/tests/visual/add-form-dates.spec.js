import { expect, test } from "@playwright/test";
import { openDashboard } from "./mocks";

// Issue #66: Next renewal used to default to today whatever the start date
// said, so a plan someone had had for years landed with the wrong totals and
// the wrong "Coming up" unless both dates were changed by hand. The suite's
// clock is frozen at 15 Sep 2026 (mocks.js).
test.beforeEach(async ({ page }) => openDashboard(page));

// Each field's hint sits inside its <label>, like the errors do, so it is
// part of the accessible name: match on how the name starts.
const field = (form, label) => form.getByLabel(new RegExp(`^${label}`));

// The same AddForm either way: inline under the table on desktop, in the add
// sheet on mobile.
async function openForm(page, isMobile) {
  if (!isMobile) return page.locator("#add form");
  await page.getByRole("button", { name: "Add subscription" }).click();
  return page.getByRole("dialog", { name: "Add a subscription" }).locator("form");
}

test("next renewal follows the start date and cycle until it is edited", async ({ page, isMobile }) => {
  const form = await openForm(page, isMobile);
  const started = field(form, "Started");
  const renewal = field(form, "Next renewal");

  await expect(started).toHaveValue("2026-09-15");
  await expect(renewal).toHaveValue("2026-09-15");
  await expect(form.getByText("Counts from")).toHaveCount(0);

  await started.fill("2024-03-20");
  await expect(renewal).toHaveValue("2026-09-20");
  await expect(form.getByText("Counts from March 2024.")).toBeVisible();
  await expect(form.getByText("Worked out from Started and Cycle.")).toBeVisible();

  await field(form, "Cycle").selectOption("yearly");
  await expect(renewal).toHaveValue("2027-03-20");

  // Once set by hand it stays put.
  await renewal.fill("2026-12-01");
  await started.fill("2025-01-05");
  await expect(renewal).toHaveValue("2026-12-01");
  await expect(form.getByText("Worked out from Started and Cycle.")).toHaveCount(0);
});

test("a trial's end date is asked for, not guessed", async ({ page, isMobile }) => {
  const form = await openForm(page, isMobile);
  await form.getByRole("button", { name: "Free trial" }).click();
  await expect(field(form, "Trial ends")).toHaveValue("");

  await field(form, "Service").fill("Notion");
  await field(form, "Price after trial").fill("8");
  await form.getByRole("button", { name: "Add trial" }).click();
  await expect(form.getByText("Required — the day the trial ends.")).toBeVisible();

  // Back to a paid plan, the suggestion comes back.
  await form.getByRole("button", { name: "Paid plan" }).click();
  await expect(field(form, "Next renewal")).toHaveValue("2026-09-15");
});
