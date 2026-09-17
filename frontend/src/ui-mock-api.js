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
].map((row) => ({ cancelled_date: null, paused_date: null, archived_date: null, ...row }));

let subscriptions = structuredClone(seedSubscriptions);
let categories = [{ id: 1, name: "Entertainment" }, { id: 2, name: "Work" }];
let nextId = 6;
let nextCategoryId = 3;
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
    month: index + 1, total: 0, subscription_ids: [],
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
      entry.total = Math.round((entry.total + Number(row.cost)) * 100) / 100;
      entry.subscription_ids.push(row.id);
    }
  }
  return { year, months, total: Math.round(months.reduce((sum, row) => sum + row.total, 0) * 100) / 100 };
}

function upcoming(days) {
  const through = new Date(2026, 8, 15 + days);
  const end = iso(through.getFullYear(), through.getMonth() + 1, through.getDate());
  let total = 0;
  for (let offset = 0; offset <= 1; offset += 1) {
    const month = new Date(2026, 8 + offset, 1);
    for (const charge of chargesInMonth(subscriptions, month.getFullYear(), month.getMonth())) {
      if (charge.iso >= today && charge.iso <= end) total += charge.cost;
    }
  }
  return { total: Math.round(total * 100) / 100, upcoming: [] };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportData(format) {
  const fields = ["name", "category", "status", "billing_cycle", "cost", "next_renewal_date", "started_date", "cancelled_date", "paused_date", "archived_date"];
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
    return json({ email });
  }
  if (path === "/me/password" && method === "PUT") {
    if (body.current_password !== password) return failure(400, "Current password is incorrect.");
    password = body.new_password;
    return json({ access_token: "ui-mock-token", token_type: "bearer" });
  }
  if (path === "/subscriptions/summary/spend") return json(spend(Number(params.get("year") || 2026), params.get("category")));
  if (path === "/subscriptions/upcoming") return json(upcoming(Number(params.get("days") || 30)));
  if (path === "/subscriptions") {
    if (method === "GET") return json([...subscriptions].sort((a, b) => a.next_renewal_date.localeCompare(b.next_renewal_date) || a.name.localeCompare(b.name)));
    if (method === "POST") {
      const row = { ...body, id: nextId, group_id: nextId++, cancelled_date: null, paused_date: null, archived_date: null };
      subscriptions.push(row);
      return json(row, 201);
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
      return json(row);
    }
    if (action === "archive") { row.archived_date = today; return json(row); }
    if (action === "unarchive") { row.archived_date = null; return json(row); }
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
