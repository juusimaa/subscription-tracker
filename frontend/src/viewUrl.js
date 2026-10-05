// The dashboard's view, kept in the query string so "Yearly 2025, sorted by
// cost, ended shown" can be bookmarked, shared and survives a reload
// (issue #67).
//
// Only what differs from the defaults is written, so a plain visit stays a
// plain URL and a bookmark of "this month" keeps meaning this month. The hash
// is left alone: the nav's #overview and #all links live there.
//
//   ?view=yearly&year=2025            a year
//   ?year=2026&month=3                a month (1-based, as people write it)
//   ?sort=cost&dir=desc               the list's sort
//   ?cancelled=1&archived=1           the list's two visibility toggles
//                                     (cancelled=1 is Show ended, issue #53;
//                                     the key is kept so old bookmarks work)
//
// Anything malformed is ignored rather than rejected, field by field.

import { MAX_YEAR, MIN_YEAR } from "./format";

export const DEFAULT_SORT = { key: "renewal", dir: "asc" };
const SORT_KEYS = ["name", "category", "status", "cost", "perMonth", "started", "renewal"];

// This month, or the nearest end of the range if today falls outside it.
// Clamping rather than showing an empty period keeps the first render
// meaningful even in 2028.
export function defaultPeriod() {
  const now = new Date();
  const year = Math.min(MAX_YEAR, Math.max(MIN_YEAR, now.getFullYear()));
  return { view: "monthly", year, month: year === now.getFullYear() ? now.getMonth() : 0 };
}

function params() {
  return new URLSearchParams(window.location.search);
}

function intIn(value, min, max) {
  if (value == null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export function readPeriod() {
  const p = params();
  const period = defaultPeriod();
  if (p.get("view") === "yearly") period.view = "yearly";
  const year = intIn(p.get("year"), MIN_YEAR, MAX_YEAR);
  if (year != null) period.year = year;
  const month = intIn(p.get("month"), 1, 12);
  if (month != null) period.month = month - 1;
  return period;
}

export function readListView() {
  const p = params();
  const key = p.get("sort");
  return {
    sort: SORT_KEYS.includes(key)
      ? { key, dir: p.get("dir") === "desc" ? "desc" : "asc" }
      : DEFAULT_SORT,
    showEnded: p.get("cancelled") === "1",
    showArchived: p.get("archived") === "1",
  };
}

// replaceState, not pushState: stepping through months should not leave a
// trail of history entries for Back to walk through one at a time.
export function writeView({ period, sort, showEnded, showArchived }) {
  const p = params();
  for (const key of ["view", "year", "month", "sort", "dir", "cancelled", "archived"]) p.delete(key);

  const home = defaultPeriod();
  const monthly = period.view === "monthly";
  const samePeriod =
    period.view === home.view && period.year === home.year && (!monthly || period.month === home.month);
  if (!samePeriod) {
    if (!monthly) p.set("view", "yearly");
    p.set("year", String(period.year));
    if (monthly) p.set("month", String(period.month + 1));
  }
  if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) {
    p.set("sort", sort.key);
    if (sort.dir === "desc") p.set("dir", "desc");
  }
  if (showEnded) p.set("cancelled", "1");
  if (showArchived) p.set("archived", "1");

  const query = p.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", url);
  }
}
