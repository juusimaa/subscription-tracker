// Runs of the same subscription, grouped (issue #49).
//
// Reactivating a cancelled plan starts a new run with its own row, and every
// run of one plan shares a group_id (#44). The list shows one entry per group:
// its head is the run that isn't cancelled, otherwise the newest one, and the
// earlier runs fold away underneath it. A plan that was never reactivated has
// no group_id and is a group of one.
//
// Only the list groups. KPIs, spend and Coming up count each run on its own,
// which is what they already did.

function newestFirst(a, b) {
  // A run with no start date predates the column, so it sorts as the oldest.
  const byStart = (b.started_date || "").localeCompare(a.started_date || "");
  return byStart || b.id - a.id;
}

export function buildGroups(subscriptions) {
  const byKey = new Map();
  for (const subscription of subscriptions) {
    const key = subscription.group_id ?? `run-${subscription.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(subscription);
  }
  return [...byKey.entries()].map(([key, runs]) => {
    const sorted = runs.slice().sort(newestFirst);
    const head = sorted.find((s) => s.status !== "cancelled") || sorted[0];
    return { key, head, earlier: sorted.filter((s) => s !== head), runs: sorted };
  });
}

// "Show cancelled — N" counts groups whose head is cancelled: earlier runs of
// a live plan are reached through its disclosure, not that toggle. Archived
// heads have their own toggle, so they are left out here as before.
export function cancelledGroupCount(groups) {
  return groups.filter((g) => g.head.status === "cancelled" && !g.head.archived_date).length;
}

// "Run 2 of 3" -- counted over every run, archived or not, so a run keeps its
// number when Show archived changes what is on screen.
export function runNumber(group, run) {
  return group.runs.length - group.runs.indexOf(run);
}

// What every run of the group has been billed, or null when any run's start
// is unknown (the API then has no honest total for it; see paid_total).
export function lifetimePaid(group) {
  if (group.runs.some((s) => s.paid_total == null)) return null;
  return group.runs.reduce((sum, s) => sum + Number(s.paid_total), 0);
}

// The earliest known start across the group: "since Mar 2022".
export function groupSince(group) {
  const starts = group.runs.map((s) => s.started_date).filter(Boolean).sort();
  return starts[0] || null;
}
