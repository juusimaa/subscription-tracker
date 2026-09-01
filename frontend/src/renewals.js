// Renewal date arithmetic in the browser, mirroring backend/app/renewals.py.
//
// Why this exists at all: GET /subscriptions/upcoming is anchored to today --
// `days` counts forward from now and tops out at 365 -- while the design's
// "Coming up" panel lists the charges in the *selected* period, and the period
// picker reaches back to January 2025 and forward to December 2027. The
// backend arithmetic is general (renewals.occurrences_between takes any start
// and end); only the route signature is today-shaped. Until it grows a
// from/to pair (TODO.md D2) the client does the same walk itself.
//
// One caveat, and it is the reason this is a mirror rather than the truth: the
// API returns `next_renewal_date`, the derived next occurrence, not the stored
// anchor. For a plan anchored on the 31st the derived date may already be
// clamped (28 Feb), and stepping from a clamped date keeps the clamp instead
// of springing back to the 31st in March, which is what the server does. Off
// by up to three days at month ends, and only for those plans.
//
// Days are handled as {y, m, d} triples rather than Date objects throughout:
// a Date built from "2026-09-04" is UTC midnight and reads as the 3rd in any
// timezone west of Greenwich, which is exactly the kind of bug a page full of
// renewal dates cannot afford.

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

function toISOParts({ y, m, d }) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Ordinal comparison without building Dates.
const rank = ({ y, m, d }) => y * 10000 + m * 100 + d;

// `anchor` shifted by whole calendar months, clamping a day the target month
// does not have (31 Jan + 1 month = 28 Feb). Always measured from the anchor,
// never from the previous result, so the clamp cannot accumulate.
function addMonths(anchor, months) {
  const total = anchor.y * 12 + anchor.m + months;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

/**
 * Every renewal of `subscription` that falls inside the given calendar month.
 *
 * Cancelled and paused plans yield nothing -- they are not going to be billed,
 * whatever their dates say. A trial yields its conversion date at most once,
 * because a trial converts one time and then bills under a different status;
 * treating its date as a recurring anchor would invent conversions that never
 * happen. Renewals before `started_date` are skipped, so a plan that starts
 * next quarter is not shown as due this month.
 *
 * Returns [{ iso, cost, isTrialConversion }], ordered by day.
 */
export function occurrencesInMonth(subscription, year, month) {
  const status = subscription.status;
  if (status === "cancelled" || status === "paused") return [];

  const anchor = parseISO(subscription.next_renewal_date);
  const started = subscription.started_date ? parseISO(subscription.started_date) : null;
  const firstOfMonth = { y: year, m: month, d: 1 };
  const lastOfMonth = { y: year, m: month, d: daysInMonth(year, month) };

  if (status === "trial") {
    if (rank(anchor) < rank(firstOfMonth) || rank(anchor) > rank(lastOfMonth)) return [];
    // At a cost of 0: nothing leaves the account on a conversion day, the
    // trial is free until it ends. The real price travels with the row so a
    // caller can still say "then EUR 9.99/mo".
    return [{ iso: toISOParts(anchor), cost: 0, isTrialConversion: true }];
  }

  const step = subscription.billing_cycle === "yearly" ? 12 : 1;
  // Jump straight to roughly the right period rather than stepping a month at
  // a time: the selected period can be years away from the anchor.
  const elapsed = (year - anchor.y) * 12 + (month - anchor.m);
  const periods = Math.floor(elapsed / step) * step;

  const out = [];
  // Two periods of slack on either side absorbs the day-of-month rounding in
  // `elapsed`, which ignores the day and so can land one period out.
  for (let n = periods - step * 2; n <= periods + step * 2; n += step) {
    const occurrence = addMonths(anchor, n);
    if (occurrence.y !== year || occurrence.m !== month) continue;
    if (started && rank(occurrence) < rank(started)) continue;
    out.push({
      iso: toISOParts(occurrence),
      cost: Number(subscription.cost),
      isTrialConversion: false,
    });
  }
  return out;
}

/** Every charge due in one month, across every subscription, soonest first. */
export function chargesInMonth(subscriptions, year, month) {
  const rows = [];
  for (const subscription of subscriptions) {
    for (const occurrence of occurrencesInMonth(subscription, year, month)) {
      rows.push({ subscription, ...occurrence });
    }
  }
  // Name and id break ties only to keep two charges on the same day in a
  // stable order rather than whatever the list happened to arrive in.
  rows.sort(
    (a, b) =>
      a.iso.localeCompare(b.iso) ||
      a.subscription.name.toLowerCase().localeCompare(b.subscription.name.toLowerCase()) ||
      a.subscription.id - b.subscription.id,
  );
  return rows;
}

/** How many charges fall in a whole calendar year -- the yearly KPI. */
export function chargeCountInYear(subscriptions, year) {
  let count = 0;
  for (let month = 0; month < 12; month += 1) {
    count += chargesInMonth(subscriptions, year, month).length;
  }
  return count;
}
