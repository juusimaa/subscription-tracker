// Formatting and calendar helpers shared across the dashboard.
//
// Currency is hardcoded to EUR because the API has no currency column -- cost
// is a bare Numeric(10,2) and every figure in the design is in euros. That is
// an assumption, not a decision anyone made (see TODO.md D7), and it lives
// here so there is exactly one place to change when a currency column exists.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// The period picker's range, straight from the design. Deliberately fixed
// rather than derived from the data: the stepper needs stable ends, and a
// range that grew as subscriptions were added would move under the user.
export const MIN_YEAR = 2025;
export const MAX_YEAR = 2027;

// en-US grouping with a euro sign, always two decimals: "€1,234.56". Note the
// absolute value -- signed figures are built by `signed` below, which uses a
// real minus sign (U+2212) rather than a hyphen, as the design specifies.
export function money(amount) {
  const n = Number(amount) || 0;
  return (
    "€" +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function signed(amount) {
  return (Number(amount) < 0 ? "−" : "+") + money(amount);
}

// "2026-09-04" -> "04 Sep 2026". Split on the string rather than parsed as a
// Date: `new Date("2026-09-04")` is UTC midnight, which renders as the 3rd in
// any timezone west of Greenwich.
export function longDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d} ${SHORT_MONTHS[Number(m) - 1]} ${y}`;
}

// "04 Sep", for the Coming up list where the year is implied by the period.
export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d} ${SHORT_MONTHS[Number(m) - 1]}`;
}

// Local-time ISO date, unlike Date.prototype.toISOString(), which converts to
// UTC first and so can hand back yesterday.
export function toISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayISO = () => toISO(new Date());

// The one subscription figure everything else is built from: what a plan
// costs per month, with a yearly plan spread across the twelve months it
// covers. Mirrors main._monthly_cost on the backend.
export function perMonth(subscription) {
  const cost = Number(subscription.cost);
  return subscription.billing_cycle === "yearly" ? cost / 12 : cost;
}

// "14 minutes ago" for the 500 banner, which has to state the real age of the
// data still on screen rather than a placeholder.
export function ageInWords(since) {
  if (!since) return "just now";
  const seconds = Math.floor((Date.now() - since) / 1000);
  if (seconds < 60) return "less than a minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
