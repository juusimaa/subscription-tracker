// Subscriptions billed in more than one currency (PLAN.md milestone 10).
// The fixture adds a USD and a GBP plan to the usual euro account; every
// total arrives converted from the API, and the per-item "≈" figures come
// from GET /rates. Covers the hero's per-currency statement, the "≈" marks,
// the rate-only change note, the table's converted sub-notes, the add form's
// currency picker and the locked currency in an edit.

import { expect, test } from "@playwright/test";
import { openDashboard, subscriptions } from "./mocks";

const foreign = [
  {
    id: 8,
    group_id: null,
    name: "ChatGPT Plus",
    cost: "20.00",
    currency: "USD",
    billing_cycle: "monthly",
    status: "active",
    category: "Work",
    started_date: "2025-09-28",
    next_renewal_date: "2026-09-28",
    cancelled_date: null,
    archived_date: null,
    paid_total: "240.00",
    paid_total_converted: 205.73,
  },
  {
    id: 9,
    group_id: null,
    name: "The Economist",
    cost: "15.00",
    currency: "GBP",
    billing_cycle: "monthly",
    status: "active",
    category: "News",
    started_date: "2026-03-09",
    next_renewal_date: "2026-10-09",
    cancelled_date: null,
    archived_date: null,
    paid_total: "105.00",
    paid_total_converted: 121.5,
  },
];

// Month by month: the two euro plans (Adobe's yearly charge in March), plus
// $20 every month and £15 from March. August and September hold the same
// charges at different rates, so September's change is the rate alone.
function month(i) {
  const eur = i === 2 ? 265.86 : 25.98;
  const usd = i === 7 ? 17.17 : 17.05;
  const gbp = i < 2 ? null : i === 7 ? 17.36 : 17.25;
  const by = [
    { currency: "EUR", native: eur, converted: eur },
    ...(gbp == null ? [] : [{ currency: "GBP", native: 15, converted: gbp }]),
    { currency: "USD", native: 20, converted: usd },
  ];
  return {
    month: i + 1,
    total: Math.round(by.reduce((sum, line) => sum + line.converted, 0) * 100) / 100,
    subscription_ids: [1, 2, ...(i === 2 ? [3] : []), 8, ...(gbp == null ? [] : [9])],
    by_currency: by,
  };
}

function summary(months) {
  return {
    year: 2026,
    currency: "EUR",
    months,
    total: Math.round(months.reduce((sum, m) => sum + m.total, 0) * 100) / 100,
    by_currency: [],
    rates_as_of: "2026-09-14",
    rates_stale: false,
  };
}

const OVERALL = summary(Array.from({ length: 12 }, (_, i) => month(i)));
const only = (code, ids) =>
  summary(
    OVERALL.months.map((m) => {
      const line = m.by_currency.find((l) => l.currency === code);
      return {
        month: m.month,
        total: line ? line.converted : 0,
        subscription_ids: line ? ids : [],
        by_currency: line ? [line] : [],
      };
    }),
  );

async function routes(page) {
  await page.route("**/subscriptions", (route) => route.fulfill({ json: [...subscriptions, ...foreign] }));
  await page.route("**/categories", (route) =>
    route.fulfill({ json: [{ id: 1, name: "Entertainment" }, { id: 2, name: "Work" }, { id: 3, name: "News" }] }),
  );
  await page.route("**/subscriptions/summary/spend*", (route) => {
    const category = new URL(route.request().url()).searchParams.get("category");
    if (category === "News") return route.fulfill({ json: only("GBP", [9]) });
    if (category === "Work") return route.fulfill({ json: only("USD", [8]) });
    if (category === "Entertainment") {
      return route.fulfill({
        json: summary(Array.from({ length: 12 }, (_, i) => ({
          month: i + 1, total: 25.98, subscription_ids: [1, 2],
          by_currency: [{ currency: "EUR", native: 25.98, converted: 25.98 }],
        }))),
      });
    }
    return route.fulfill({ json: OVERALL });
  });
  await page.route("**/subscriptions/upcoming*", (route) =>
    route.fulfill({
      json: {
        total: 60.28,
        currency: "EUR",
        renewals: [{ subscription: foreign[0], renewal_date: "2026-09-28", cost: 20, converted_cost: 17.05 }],
      },
    }),
  );
  await page.route("**/rates", (route) =>
    route.fulfill({
      json: {
        base: "EUR",
        currency: "EUR",
        as_of: "2026-09-14",
        stale: false,
        missing: [],
        rates: {
          USD: [["2025-09-26", 1.169], ["2026-08-28", 1.165], ["2026-09-14", 1.173]],
          GBP: [["2026-03-09", 0.861], ["2026-09-09", 0.8695], ["2026-09-14", 0.8695]],
        },
      },
    }),
  );
}

test.beforeEach(async ({ page }) => openDashboard(page, "/", { me: { currency: "EUR" }, routes }));

test("dashboard in three currencies", async ({ page }) => {
  await expect(page.locator(".fx-breakdown")).toContainText("$20.00");
  await expect(page).toHaveScreenshot("currency-dashboard.png", { fullPage: true });
});

// Critique 2026-10-06, issue 2: the per-currency statement pushed the next
// charge and the trial's keep/cancel actions off the first phone screen.
// It folds there now, and the strip comes before the period controls.
test("the next charge and its actions are on the first phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile first viewport");
  const toggle = page.getByRole("button", { name: /In each currency/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".fx-grid")).toBeHidden();

  const bar = await page.locator(".mobile-action-bar").boundingBox();
  for (const button of await page.locator(".next-charge button").all()) {
    const box = await button.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  }

  await toggle.click();
  await expect(page.locator(".fx-grid")).toBeVisible();
});

// The one running trial is already in the next-charge strip with both its
// actions, so the full trial list below would only repeat it.
test("a single trial is not repeated in a trial section", async ({ page }) => {
  await expect(page.locator(".next-charge")).toContainText("Notion");
  await expect(page.locator(".trial-banner")).toHaveCount(0);
});

test("the change since last month says when it is only the rate", async ({ page }) => {
  await expect(page.locator(".kpis")).toContainText("The difference is the exchange rate.");
});

test("a new subscription can be added in another currency", async ({ page }) => {
  let submitted;
  await page.route("**/subscriptions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { ...foreign[0], id: 10 } });
  });
  const mobile = await page.locator(".mobile-action-bar .btn").isVisible();
  if (mobile) await page.locator(".mobile-action-bar .btn").click();
  else await page.getByRole("button", { name: /^Add a subscription/ }).click();
  const form = mobile ? page.getByRole("dialog") : page.locator("#add");
  await form.getByLabel("Service").fill("Claude Pro");
  await form.getByLabel("Cost", { exact: true }).fill("18");
  await form.getByLabel("Currency").selectOption("USD");
  await expect(form.getByText("Totals show it in euros, at the ECB rate.")).toBeVisible();
  await expect(form).toHaveScreenshot("currency-add-form.png");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => submitted?.currency).toBe("USD");
});

// Critique 2026-10-06, issue 4: currency honesty gaps.

test("the hero names the totals' currency and links to changing it", async ({ page }) => {
  const line = page.locator(".hero-currency");
  await expect(line).toContainText("Totals in EUR");
  await line.getByRole("button", { name: "Change currency" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".currency-select")).toBeFocused();
  await expect(dialog.locator(".currency-select")).toBeInViewport();
});

test("Per month is in the user's currency on desktop too, native under it", async ({ page, isMobile }) => {
  test.skip(isMobile, "the mobile row already shows the converted note");
  const row = page.locator("tr", { hasText: "ChatGPT Plus" });
  const cell = row.locator("td").nth(4);
  await expect(cell).toContainText(/≈.*€17\.05/);
  await expect(cell.locator(".sub-note")).toHaveText("$20.00");
});

test("Largest charge names its period", async ({ page }) => {
  await expect(page.locator(".kpis")).toContainText("Largest charge this month — ");
});

test("a change that rounds to nothing carries no ≈", async ({ page }) => {
  // August at September's total: the same charges, and this time the same
  // converted figure too.
  const flat = summary(OVERALL.months.map((m, i) => (i === 7 ? { ...OVERALL.months[8], month: 8 } : m)));
  await page.route("**/subscriptions/summary/spend*", (route) =>
    new URL(route.request().url()).searchParams.get("category") ? route.fallback() : route.fulfill({ json: flat }),
  );
  await page.reload();
  const change = page.locator(".kpis > *", { hasText: "Change since" });
  await expect(change).toContainText("€0.00");
  await expect(change.locator(".approx")).toHaveCount(0);
});
