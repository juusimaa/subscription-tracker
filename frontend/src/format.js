// Formatting and calendar helpers shared across the dashboard.
//
// Currency is hardcoded to EUR because the API has no currency column -- cost
// is a bare Numeric(10,2) and every figure in the design is in euros. That is
// an assumption, not a decision anyone made (see TODO.md D7), and it lives
// here so there is exactly one place to change when a currency column exists.

//
// Everything a reader sees -- month names, the money format, dates, the cost
// field's complaints -- follows the interface language (src/i18n.js). In
// Finnish that means "1 234,56 €" and "4.9.2026"; in English "€1,234.56" and
// "04 Sep 2026", as before.

import { getLanguage, getLocaleTag, t } from "./i18n";

// Month names by zero-based index, in the current language. Finnish names
// are lower case and nominative ("syyskuu"); see locales/common.js.
export const monthName = (index) => t("months.long")[index];
export const shortMonthName = (index) => t("months.short")[index];

// The period picker's range, straight from the design. Deliberately fixed
// rather than derived from the data: the stepper needs stable ends, and a
// range that grew as subscriptions were added would move under the user.
export const MIN_YEAR = 2025;
export const MAX_YEAR = 2027;

// Always two decimals, grouped the way the language writes numbers:
// "€1,234.56" in English, "1 234,56 €" in Finnish (with no-break spaces, so
// the figure never wraps away from its sign). Note the absolute value --
// signed figures are built by `signed` below, which uses a real minus sign
// (U+2212) rather than a hyphen, as the design specifies.
export function money(amount) {
  const n = Number(amount) || 0;
  const digits = Math.abs(n).toLocaleString(getLocaleTag(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return getLanguage() === "fi" ? `${digits}\u00a0€` : `€${digits}`;
}

// Rounded to the cent before the sign is chosen, so a difference that prints
// as €0.00 never carries a sign it does not have ("−€0.00" from a float
// remainder, or "+€0.00" for no change at all).
export function signed(amount) {
  const cents = Math.round((Number(amount) || 0) * 100);
  if (cents === 0) return money(0);
  return (cents < 0 ? "−" : "+") + money(cents / 100);
}

// A typed cost, as a number, or NaN when it is not one. Every figure on this
// page is in euros, and most people who pay in euros write a decimal comma:
// "9,99" is accepted as 9.99 rather than refused as "not greater than 0".
// A thousands separator is not guessed at -- "1.299,00" and "1,299.00" are
// both NaN, so the form asks again instead of saving a price off by 1000x.
// More than two decimals is NaN too, matching what the server accepts.
export function parseAmount(text) {
  const trimmed = String(text ?? "").trim().replace(/\s/g, "");
  if (!/^(\d+([.,]\d{1,2})?|[.,]\d{1,2})$/.test(trimmed)) return NaN;
  return Number(trimmed.replace(",", "."));
}

// The server's ceiling on a cost: Numeric(10, 2), see schemas.Cost.
export const MAX_COST = 99999999.99;

// The check every cost field runs before saving: the message for what is
// wrong with it, or null when it is a cost the server will take.
export function costProblem(text) {
  if (!String(text ?? "").trim()) return t("cost.required");
  const value = parseAmount(text);
  if (Number.isNaN(value)) return t("cost.notNumber");
  if (!(value > 0)) return t("cost.notPositive");
  if (value > MAX_COST) return t("cost.tooLarge");
  return null;
}

// "2026-09-04" -> "04 Sep 2026", or "4.9.2026" in Finnish. Split on the
// string rather than parsed as a Date: `new Date("2026-09-04")` is UTC
// midnight, which renders as the 3rd in any timezone west of Greenwich.
export function longDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (getLanguage() === "fi") return `${Number(d)}.${Number(m)}.${y}`;
  return `${d} ${shortMonthName(Number(m) - 1)} ${y}`;
}

// "04 Sep" (or "4.9."), for the Coming up list where the year is implied by
// the period.
export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  if (getLanguage() === "fi") return `${Number(d)}.${Number(m)}.`;
  return `${d} ${shortMonthName(Number(m) - 1)}`;
}

// Local-time ISO date, unlike Date.prototype.toISOString(), which converts to
// UTC first and so can hand back yesterday.
export function toISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayISO = () => toISO(new Date());

// How many months one billing period covers. Mirrors models.CYCLE_MONTHS on
// the backend.
export const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

// The one subscription figure everything else is built from: what a plan
// costs per month, with a quarterly or yearly plan spread across the months
// it covers. Mirrors main._monthly_cost on the backend.
export function perMonth(subscription) {
  const cost = Number(subscription.cost);
  return cost / CYCLE_MONTHS[subscription.billing_cycle];
}

// "/mo", "/qtr" or "/yr" ("/kk", "/nelj.", "/v") -- the short form used next
// to a price wherever space is tight (trial rows, the mobile table).
export function cycleSuffix(billing_cycle) {
  if (billing_cycle === "yearly") return t("cycle.suffix.yearly");
  if (billing_cycle === "quarterly") return t("cycle.suffix.quarterly");
  return t("cycle.suffix.monthly");
}

// "Monthly", "Quarterly" or "Yearly", for selects and labels.
export const cycleLabel = (billing_cycle) => t(`cycle.${billing_cycle}`);

// "Active", "Trial", "Paused", "Cancelled" (and "Archived"), for selects and
// tags.
export const statusLabel = (status) => t(`status.${status}`);

// "14 minutes ago" for the 500 banner, which has to state the real age of the
// data still on screen rather than a placeholder.
export function ageInWords(since) {
  if (!since) return t("age.now");
  const seconds = Math.floor((Date.now() - since) / 1000);
  if (seconds < 60) return t("age.underMinute");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("age.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("age.hours", { n: hours });
  return t("age.days", { n: Math.floor(hours / 24) });
}
