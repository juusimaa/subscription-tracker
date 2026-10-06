// In-memory stand-in for the routes App.jsx uses. It is installed only by
// ui-mock.jsx; the production entry point and API transport are untouched.
import { chargesInMonth } from "./renewals";

const SAMPLE_TIME = new Date(2026, 8, 15, 12).getTime();
const API_PATH = "/__ui_mock_api__";

const seedSubscriptions = [
  { id: 1, group_id: 1, name: "Netflix", cost: 15.99, billing_cycle: "monthly", status: "active", category: "Entertainment", started_date: "2024-01-10", next_renewal_date: "2026-09-20" },
  { id: 2, group_id: 2, name: "Spotify", cost: 9.99, billing_cycle: "monthly", status: "active", category: "Entertainment", started_date: "2023-05-01", next_renewal_date: "2026-09-05" },
  { id: 3, group_id: 3, name: "Adobe Creative Cloud", cost: 239.88, billing_cycle: "yearly", status: "active", category: "Work", started_date: "2025-03-12", next_renewal_date: "2027-03-12" },
  { id: 4, group_id: 4, name: "Notion", cost: 8, billing_cycle: "monthly", status: "trial", category: "Work", started_date: "2026-09-01", next_renewal_date: "2026-09-25" },
  { id: 5, group_id: 5, name: "Dropbox", cost: 11.99, billing_cycle: "monthly", status: "cancelled", category: "Work", started_date: "2022-02-14", next_renewal_date: "2026-07-01", cancelled_date: "2026-07-01" },
  // Two plans billed in other currencies (PLAN.md milestone 10).
  { id: 6, group_id: 6, name: "ChatGPT Plus", cost: 20, currency: "USD", billing_cycle: "monthly", status: "active", category: "Work", started_date: "2025-09-28", next_renewal_date: "2026-09-28" },
  { id: 7, group_id: 7, name: "The Economist", cost: 15, currency: "GBP", billing_cycle: "monthly", status: "active", category: "News", started_date: "2026-03-09", next_renewal_date: "2026-09-09" },
].map((row) => ({ currency: "EUR", cancelled_date: null, paused_date: null, archived_date: null, ...row }));

// Fixed sample rates, units per 1 EUR, as if the ECB had published these on
// 14 Sep 2026 and nothing else. The real API converts each charge at its own
// day's rate; one rate for every day is enough for a harness.
const RATES = {
  EUR: 1, USD: 1.173, GBP: 0.8695, SEK: 11.02, NOK: 11.7, DKK: 7.46, CHF: 0.935, PLN: 4.27,
  CZK: 24.4, AUD: 1.77, BRL: 6.38, CAD: 1.61, CNY: 8.36, HKD: 9.14, HUF: 392.5, IDR: 19210,
  ILS: 4.38, INR: 98.6, ISK: 143.1, JPY: 172.4, KRW: 1625, MXN: 21.6, MYR: 4.95, NZD: 1.97,
  PHP: 66.8, RON: 5.07, SGD: 1.5, THB: 37.9, TRY: 48.3, ZAR: 20.6,
};
const RATES_AS_OF = "2026-09-14";
let currency = "EUR";
const round2 = (n) => Math.round(n * 100) / 100;
const toUser = (amount, code = "EUR") =>
  code === currency ? round2(Number(amount)) : round2((Number(amount) / RATES[code]) * RATES[currency]);

let subscriptions = structuredClone(seedSubscriptions);
let categories = [{ id: 1, name: "Entertainment" }, { id: 2, name: "Work" }, { id: 3, name: "News" }];
let nextId = 8;
let nextCategoryId = 4;
let email = "demo@example.com";
let password = "demo-password";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const failure = (status, detail) => json({ detail }, status);
const iso = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const today = "2026-09-15";
const cycleMonths = { monthly: 1, quarterly: 3, yearly: 12 };

function addMonths(anchor, count) {
  const [year, month, day] = anchor.split("-").map(Number);
  const target = new Date(year, month - 1 + count, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return iso(target.getFullYear(), target.getMonth() + 1, Math.min(day, last));
}

// The backend's spend view anchors charges to started_date, including a
// stopped plan's past charges. The client-side Coming up panel uses the
// separate next_renewal_date schedule in renewals.js, just as the app does.
function spend(year, category) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1, total: 0, subscription_ids: [], by: {},
  }));
  for (const row of subscriptions) {
    if (row.status === "trial") continue;
    if (category && row.category?.toLowerCase() !== category.toLowerCase()) continue;
    const anchor = row.started_date || row.next_renewal_date;
    const stop = row.status === "cancelled" ? row.cancelled_date
      : row.status === "paused" ? row.paused_date : null;
    if ((row.status === "cancelled" || row.status === "paused") && !stop) continue;
    const first = Number(anchor.slice(0, 4));
    const periods = Math.ceil(((year - first) * 12 - 12) / cycleMonths[row.billing_cycle]);
    for (let n = Math.max(0, periods); n < 500; n += 1) {
      const date = addMonths(anchor, n * cycleMonths[row.billing_cycle]);
      if (date.slice(0, 4) > String(year)) break;
      if (date.slice(0, 4) !== String(year) || (stop && date > stop)) continue;
      const entry = months[Number(date.slice(5, 7)) - 1];
      const converted = toUser(row.cost, row.currency);
      entry.total = round2(entry.total + converted);
      entry.subscription_ids.push(row.id);
      const line = (entry.by[row.currency] ??= { native: 0, converted: 0 });
      line.native = round2(line.native + Number(row.cost));
      line.converted = round2(line.converted + converted);
    }
  }
  // The user's own currency first, then the largest share, as the API does.
  const lines = (by) => Object.entries(by)
    .sort(([a, x], [b, y]) => (a !== currency) - (b !== currency) || y.converted - x.converted)
    .map(([code, line]) => ({ currency: code, ...line }));
  const yearBy = {};
  for (const entry of months) {
    for (const [code, line] of Object.entries(entry.by)) {
      const sum = (yearBy[code] ??= { native: 0, converted: 0 });
      sum.native = round2(sum.native + line.native);
      sum.converted = round2(sum.converted + line.converted);
    }
  }
  return {
    year,
    currency,
    months: months.map(({ by, ...entry }) => ({ ...entry, by_currency: lines(by) })),
    total: round2(months.reduce((sum, row) => sum + row.total, 0)),
    by_currency: lines(yearBy),
    rates_as_of: RATES_AS_OF,
    rates_stale: false,
  };
}

function upcoming(days) {
  const through = new Date(2026, 8, 15 + days);
  const end = iso(through.getFullYear(), through.getMonth() + 1, through.getDate());
  let total = 0;
  const renewals = [];
  for (let offset = 0; offset <= 1; offset += 1) {
    const month = new Date(2026, 8 + offset, 1);
    for (const charge of chargesInMonth(subscriptions, month.getFullYear(), month.getMonth())) {
      if (charge.iso < today || charge.iso > end) continue;
      const converted = toUser(charge.cost, charge.subscription.currency);
      total += converted;
      renewals.push({ subscription: charge.subscription, renewal_date: charge.iso, cost: charge.cost, converted_cost: converted });
    }
  }
  return { total: round2(total), currency, renewals, rates_as_of: RATES_AS_OF, rates_stale: false };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportData(format) {
  const fields = ["name", "category", "status", "billing_cycle", "cost", "next_renewal_date", "started_date", "cancelled_date", "paused_date", "archived_date", "currency"];
  if (format === "csv") {
    return [fields.join(","), ...subscriptions.map((row) => fields.map((field) => csvCell(row[field])).join(","))].join("\n");
  }
  return JSON.stringify({ version: 2, categories: categories.map((row) => row.name), subscriptions });
}

function importData(backup, mode) {
  if (mode === "replace") { subscriptions = []; categories = []; }
  for (const name of backup.categories || []) {
    if (!categories.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      categories.push({ id: nextCategoryId++, name });
    }
  }
  for (const incoming of backup.subscriptions || []) {
    const existing = mode === "merge"
      ? subscriptions.find((row) => row.name.toLowerCase() === incoming.name.toLowerCase())
      : null;
    if (existing) Object.assign(existing, incoming);
    else subscriptions.push({ ...incoming, id: nextId, group_id: nextId++ });
    if (incoming.category && !categories.some((row) => row.name.toLowerCase() === incoming.category.toLowerCase())) {
      categories.push({ id: nextCategoryId++, name: incoming.category });
    }
  }
}

// models.Subscription.paid_total: one charge per cycle from started_date up
// to the day it stopped or today. A trial is a real zero; no start is null.
function paidTotal(row) {
  if (row.status === "trial") return 0;
  if (!row.started_date) return null;
  const stop = row.status === "cancelled" ? row.cancelled_date
    : row.status === "paused" ? row.paused_date : null;
  if ((row.status === "cancelled" || row.status === "paused") && !stop) return 0;
  const end = stop && stop < today ? stop : today;
  let total = 0;
  for (let n = 0; n < 1200; n += 1) {
    if (addMonths(row.started_date, n * cycleMonths[row.billing_cycle]) > end) break;
    total += Number(row.cost);
  }
  return Math.round(total * 100) / 100;
}

// Read-only and computed on every response, as the API does.
const withPaid = (row) => {
  const paid = paidTotal(row);
  return { ...row, paid_total: paid, paid_total_converted: paid == null ? null : toUser(paid, row.currency) };
};

// GET /rates: the codes on the account plus the user's own, one rate each.
function rates() {
  const codes = new Set([...subscriptions.map((row) => row.currency), currency]);
  codes.delete("EUR");
  return {
    base: "EUR",
    currency,
    as_of: RATES_AS_OF,
    stale: false,
    missing: [],
    rates: Object.fromEntries([...codes].map((code) => [code, [["2020-01-01", RATES[code]]]])),
  };
}

async function route(path, method, body, params) {
  if (path === "/token" && method === "POST") {
    const form = new URLSearchParams(body);
    if (!form.get("username") || !form.get("password")) return failure(400, "Enter an email and password.");
    email = form.get("username");
    password = form.get("password");
    return json({ access_token: "ui-mock-token", token_type: "bearer" });
  }
  if (path === "/register" && method === "POST") {
    email = body.email;
    password = body.password;
    return json({ email }, 201);
  }
  if (path === "/me") {
    if (method === "DELETE") { subscriptions = []; categories = []; return new Response(null, { status: 204 }); }
    if (method === "PATCH") {
      if (!RATES[body.currency]) return failure(422, "Unsupported currency");
      currency = body.currency;
    }
    return json({ email, email_verified: true, currency });
  }
  if (path === "/me/password" && method === "PUT") {
    if (body.current_password !== password) return failure(400, "Current password is incorrect.");
    password = body.new_password;
    return json({ access_token: "ui-mock-token", token_type: "bearer" });
  }
  if (path === "/rates") return json(rates());
  if (path === "/subscriptions/summary/spend") return json(spend(Number(params.get("year") || 2026), params.get("category")));
  if (path === "/subscriptions/upcoming") return json(upcoming(Number(params.get("days") || 30)));
  if (path === "/subscriptions") {
    if (method === "GET") return json([...subscriptions].sort((a, b) => a.next_renewal_date.localeCompare(b.next_renewal_date) || a.name.localeCompare(b.name)).map(withPaid));
    if (method === "POST") {
      const row = { currency, ...body, id: nextId, group_id: nextId++, cancelled_date: null, paused_date: null, archived_date: null };
      subscriptions.push(row);
      return json(withPaid(row), 201);
    }
  }
  if (path.startsWith("/subscriptions/")) {
    const [, , id, action] = path.split("/");
    const row = subscriptions.find((item) => item.id === Number(id));
    if (!row) return failure(404, "Subscription not found");
    if (method === "DELETE") {
      subscriptions = subscriptions.filter((item) => item.id !== row.id);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      Object.assign(row, body);
      if (body.status === "cancelled") row.cancelled_date = body.cancelled_date || today;
      if (body.status === "paused") row.paused_date = today;
      if (body.status === "active") row.paused_date = null;
      return json(withPaid(row));
    }
    if (action === "archive") { row.archived_date = today; return json(withPaid(row)); }
    if (action === "unarchive") { row.archived_date = null; return json(withPaid(row)); }
    if (action === "restore") {
      const restored = { ...row, ...body, id: nextId++, status: "active", cancelled_date: null, paused_date: null, archived_date: null };
      subscriptions.push(restored);
      return json(restored, 201);
    }
  }
  if (path === "/categories") {
    if (method === "GET") return json(categories);
    const name = body.name.trim();
    if (categories.some((row) => row.name.toLowerCase() === name.toLowerCase())) return failure(409, "Category already exists");
    const category = { id: nextCategoryId++, name };
    categories.push(category);
    return json(category, 201);
  }
  if (path.startsWith("/categories/")) {
    const category = categories.find((row) => row.id === Number(path.split("/")[2]));
    if (!category) return failure(404, "Category not found");
    if (method === "DELETE") {
      if (subscriptions.some((row) => row.category === category.name)) return failure(409, "Category is in use");
      categories = categories.filter((row) => row.id !== category.id);
      return new Response(null, { status: 204 });
    }
    const oldName = category.name;
    category.name = body.name.trim();
    subscriptions.forEach((row) => { if (row.category === oldName) row.category = category.name; });
    return json(category);
  }
  if (path === "/export") return new Response(exportData(params.get("format")), { headers: { "Content-Type": "text/plain" } });
  if (path === "/import") { importData(body, params.get("mode")); return json({ imported: true }); }
  return failure(404, `No sample response for ${method} ${path}`);
}

export function installMockApi() {
  // The fixed date matches the frontend's visual fixture and keeps this
  // reference page stable even when it is opened months later.
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [SAMPLE_TIME])); }
    static now() { return SAMPLE_TIME; }
  };
  window.__API_URL__ = `${window.location.origin}${API_PATH}`;
  window.__UI_MOCK__ = true;
  localStorage.setItem("ui-mock-token", "ui-mock-token");
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (!url.pathname.startsWith(API_PATH)) return originalFetch(input, options);
    const path = url.pathname.slice(API_PATH.length);
    const method = (options.method || "GET").toUpperCase();
    const body = path === "/token" ? options.body : options.body ? JSON.parse(options.body) : null;
    return route(path, method, body, url.searchParams);
  };
}
