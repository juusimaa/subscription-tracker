// Fixed fixture data + route mocking for the visual regression suite.
//
// Every screenshot in this suite is taken against these exact numbers, dates
// and names -- never a real backend. That's what makes a diff mean "the UI
// changed" rather than "the data changed": a real account's renewal dates
// shift every day, which would make every baseline stale by tomorrow for
// reasons that have nothing to do with the UI. See openDashboard() below for
// the other half of this (freezing "now").

const subscriptions = [
  {
    id: 1,
    group_id: 1,
    name: "Netflix",
    cost: "15.99",
    billing_cycle: "monthly",
    status: "active",
    category: "Entertainment",
    started_date: "2024-01-10",
    next_renewal_date: "2026-09-20",
    cancelled_date: null,
    archived_date: null,
    paid_total: "527.67",
  },
  {
    id: 2,
    group_id: null,
    name: "Spotify",
    cost: "9.99",
    billing_cycle: "monthly",
    status: "active",
    category: "Entertainment",
    started_date: "2023-05-01",
    next_renewal_date: "2026-09-05",
    cancelled_date: null,
    archived_date: null,
    paid_total: "409.59",
  },
  {
    id: 3,
    group_id: null,
    name: "Adobe Creative Cloud",
    cost: "239.88",
    billing_cycle: "yearly",
    status: "active",
    category: "Work",
    started_date: "2025-03-12",
    next_renewal_date: "2027-03-12",
    cancelled_date: null,
    archived_date: null,
    paid_total: "479.76",
  },
  {
    id: 4,
    group_id: null,
    name: "Notion",
    cost: "8.00",
    billing_cycle: "monthly",
    status: "trial",
    category: "Work",
    started_date: "2026-09-01",
    next_renewal_date: "2026-09-25",
    cancelled_date: null,
    archived_date: null,
    paid_total: "0.00",
  },
  {
    id: 5,
    group_id: null,
    name: "Dropbox",
    cost: "11.99",
    billing_cycle: "monthly",
    status: "cancelled",
    category: "Work",
    started_date: "2022-02-14",
    next_renewal_date: "2026-07-01",
    cancelled_date: "2026-07-01",
    archived_date: null,
    paid_total: "635.47",
  },
  // Two earlier runs of Netflix (issue #49): it was cancelled and
  // reactivated twice, so all three rows share group 1. The oldest one is
  // archived, which hides it inside the group until Show archived is on.
  {
    id: 6,
    group_id: 1,
    name: "Netflix",
    cost: "12.99",
    billing_cycle: "monthly",
    status: "cancelled",
    category: "Entertainment",
    started_date: "2022-08-10",
    next_renewal_date: "2023-12-10",
    cancelled_date: "2023-11-10",
    archived_date: null,
    paid_total: "207.84",
  },
  {
    id: 7,
    group_id: 1,
    name: "Netflix",
    cost: "9.99",
    billing_cycle: "monthly",
    status: "cancelled",
    category: "Entertainment",
    started_date: "2020-03-01",
    next_renewal_date: "2021-07-01",
    cancelled_date: "2021-06-01",
    archived_date: "2021-08-01",
    paid_total: "159.84",
  },
];

const categories = [
  { id: 1, name: "Entertainment" },
  { id: 2, name: "Work" },
];

// March carries Adobe's one yearly charge; every other month is just the two
// monthly plans. Three years, same shape, since nothing here needs to differ
// year over year -- only the shape of "one bumped month" is being tested.
// `subscription_ids` mirrors what /summary/spend actually returns: who billed
// that month, not everyone still carrying the category label -- Notion (a
// trial) never appears here even though it's tagged Work, since a trial
// hasn't been charged.
function monthsArray(marchTotal, flatTotal, marchIds, flatIds) {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: i === 2 ? marchTotal : flatTotal,
    subscription_ids: i === 2 ? marchIds : flatIds,
  }));
}

const OVERALL = { months: monthsArray(265.86, 25.98, [1, 2, 3], [1, 2]), total: 551.64 };
const ENTERTAINMENT = { months: monthsArray(25.98, 25.98, [1, 2], [1, 2]), total: 311.76 };
const WORK = { months: monthsArray(239.88, 0, [3], []), total: 239.88 };

function spendFor(category) {
  if (category === "Entertainment") return ENTERTAINMENT;
  if (category === "Work") return WORK;
  return OVERALL;
}

// "Now", for every test in this suite. Frozen so the dashboard's default
// period (this month) and every relative-date calculation come out the same
// regardless of which real day the suite runs on -- otherwise every baseline
// goes stale the moment the calendar turns over, for reasons that have
// nothing to do with the UI. Falls inside the fixture dates above on
// purpose: Netflix (20th) and Notion's trial conversion (25th) both land in
// this month's "Coming up" panel.
const FROZEN_NOW = "2026-09-15T12:00:00";

/** Points every API call this app makes at the fixture data above. */
async function mockApi(page) {
  await page.route("**/me", (route) => route.fulfill({ json: { email: "demo@example.com" } }));
  await page.route("**/subscriptions", (route) => route.fulfill({ json: subscriptions }));
  await page.route("**/subscriptions/upcoming*", (route) =>
    route.fulfill({ json: { total: 25.98 } }),
  );
  await page.route("**/categories", (route) => route.fulfill({ json: categories }));
  await page.route("**/subscriptions/summary/spend*", (route) => {
    const url = new URL(route.request().url());
    route.fulfill({ json: spendFor(url.searchParams.get("category")) });
  });
}

/**
 * Loads the dashboard against the fixture data with time frozen, and waits
 * for real content instead of a fixed delay. Call this as the whole of a
 * test file's beforeEach.
 */
export async function openDashboard(page) {
  await page.clock.install({ time: new Date(FROZEN_NOW) });
  // App.jsx reads the token from localStorage on its very first render (see
  // api.js's getToken), so this has to be in place before page.goto()
  // resolves -- an init script is the only hook that runs early enough.
  await page.addInitScript(() => localStorage.setItem("token", "visual-test-token"));
  await mockApi(page);
  await page.goto("/");
  await page.getByText("Netflix").first().waitFor();
}
