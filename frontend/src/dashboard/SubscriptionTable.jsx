// The full list: sortable, inline-editable, statuses and all.
//
// Sorting is client-side, which costs nothing here -- GET /subscriptions
// returns the whole unpaginated list, and it already arrives in the design's
// default order (next renewal, then name). Ties always break on name so a
// column of equal values does not reshuffle itself between renders.
//
// Editing happens in the row. A modal would hide the neighbouring rows, which
// are the context for whether a number looks right.
//
// Runs of the same plan are grouped (issue #49, see groups.js): one row per
// group, its earlier runs folded away underneath. Filtering, search and
// sorting all work on groups, so a group is never split up.

import { Fragment, useEffect, useState } from "react";
import { ApiError, describeWriteError } from "../api";
import MonoTile from "../MonoTile";
import Sheet from "./Sheet";
import { ChevronRight, Search, TriangleAlert } from "../icons";
import {
  approxText,
  costProblem,
  cycleLabel,
  cycleSuffix,
  longDate,
  money,
  parseAmount,
  perMonth,
  shortMonthName,
  statusLabel,
  todayISO,
} from "../format";
import { ApproxMark, Converted } from "../Approx";
import { comparable, convert, currencyName, isForeign } from "../fx";
import { t } from "../i18n";
import { NAME_MAX } from "./AddForm";
import { useIsMobile } from "../useMediaQuery";
import {
  accessEnded,
  buildGroups,
  endedGroupCount,
  groupSince,
  lifetimeConverted,
  lifetimeCurrency,
  lifetimePaid,
  lifetimePaidConverted,
  runNumber,
  stoppedDate,
} from "./groups";

// The sort chip row (mobile only) offers six of the desktop table's seven
// columns -- "Per month" is left out, the same way the mobile row shows a
// combined cost line instead of a separate Per month column. Labels are
// looked up at render time so they follow the interface language.
const CHIPS = [
  { key: "renewal", label: () => t("table.chip.renewal") },
  { key: "name", label: () => t("table.col.name") },
  { key: "cost", label: () => t("table.col.cost") },
  { key: "paid", label: () => t("table.chip.paid") },
  { key: "category", label: () => t("table.col.category") },
  { key: "status", label: () => t("table.col.status") },
];

// Columns whose first click sorts largest first: what a service has cost is
// asked as "which cost me the most", not "which cost me the least".
const DESC_FIRST = new Set(["paid"]);

// The mobile row's one meta line combines category with whatever the
// desktop table says in two places (the Next renewal cell's date and its
// sub-note): "Entertainment · 04 Sep 2026", "Work · access ends 30 Oct 2026",
// "Work · access ended 30 Jul 2026".
function mobileMeta(subscription) {
  const cancelled = subscription.status === "cancelled";
  const trial = subscription.status === "trial";
  const paused = subscription.status === "paused";
  let dateText;
  if (cancelled && !subscription.cancelled_date) dateText = "—";
  else if (cancelled) {
    const date = longDate(subscription.next_renewal_date);
    dateText = t(accessEnded(subscription) ? "table.accessEndedOn" : "table.accessEndsOn", { date });
  }
  else if (paused) dateText = t("table.resumes");
  else if (trial) dateText = t("table.trialEndsOn", { date: longDate(subscription.next_renewal_date) });
  else dateText = longDate(subscription.next_renewal_date);
  return subscription.category ? `${subscription.category} · ${dateText}` : dateText;
}

// The billing cycle as the small note under a price: "monthly", or
// "kuukausittain" in Finnish.
const cycleNote = (billing_cycle) => cycleLabel(billing_cycle).toLowerCase();

// "then €9.99/mo", under a trial's €0.00.
const thenNote = (subscription) =>
  t("table.then", {
    price: `${money(subscription.cost, subscription.currency)}${cycleSuffix(subscription.billing_cycle)}`,
  });

// Under the mobile row's native cost: what it comes to per month in the
// user's currency, "≈"-marked when converted (PLAN.md milestone 10).
function mobilePerMonthNote(subscription) {
  if (subscription.status === "trial") return thenNote(subscription);
  if (subscription.status === "active") {
    const monthly = perMonth(subscription);
    const converted = isForeign(subscription.currency) ? convert(monthly, subscription.currency) : null;
    const amount = converted != null ? approxText(converted) : money(monthly, subscription.currency);
    return `${amount}${cycleSuffix("monthly")}`;
  }
  return cycleNote(subscription.billing_cycle);
}

// The Per month cell: a comparison across rows, so it is in the user's
// currency like the mobile row's note and the column's sort, "≈"-marked when
// converted, with the native figure under it. The Cost cell beside it keeps
// what actually charges in its own currency.
function PerMonthCell({ subscription }) {
  if (subscription.status !== "active") return "—";
  const monthly = perMonth(subscription);
  const converted = isForeign(subscription.currency) ? convert(monthly, subscription.currency) : null;
  if (converted == null) return money(monthly, subscription.currency);
  return (
    <>
      <span>
        <ApproxMark />
        {money(converted)}
      </span>
      <span className="sub-note">{money(monthly, subscription.currency)}</span>
    </>
  );
}

// A cost cell's sub-note: the cycle, then "≈ €17.05" when the cost is in
// another currency than the user's, at the latest rate.
function CostNote({ subscription }) {
  return (
    <>
      {cycleNote(subscription.billing_cycle)}
      {isForeign(subscription.currency) && (
        <>
          {" · "}
          <Converted amount={convert(subscription.cost, subscription.currency)} className="" />
        </>
      )}
    </>
  );
}

// The lifetime figure in its currency, "≈"-marked when its runs were billed
// in different currencies and it had to be added up in the user's.
function PaidAmount({ group }) {
  const paid = lifetimePaid(group);
  if (paid == null) return "—";
  return (
    <>
      {lifetimeConverted(group) && <ApproxMark />}
      {money(paid, lifetimeCurrency(group))}
    </>
  );
}

// Each status's tag style; its words come from statusLabel (format.js).
const STATUS_TAG = {
  active: "tag tag-neutral",
  trial: "tag tag-accent",
  paused: "tag tag-outline",
  cancelled: "tag tag-outline",
};

// The status a row's tag shows: "Scheduled" for an active plan that has not
// started yet, otherwise the status itself.
const shownStatus = (subscription) =>
  isScheduled(subscription) ? t("table.scheduled") : statusLabel(subscription.status);

// Fixed, not alphabetical: the order is how far along a subscription is
// towards costing nothing, which is the thing worth grouping by.
const STATUS_ORDER = { active: 0, trial: 1, paused: 2, cancelled: 3 };

function isScheduled(subscription) {
  return subscription.status === "active" && subscription.started_date > todayISO();
}

// Every row's secondary actions, described rather than left as bare verbs.
// Each is a lookup by action key ("cancel", "archive", ...), made at render
// time so it follows the interface language.
const menuLabel = (key) => t(`table.menu.${key}`);
const menuHint = (key) => t(`table.hint.${key}`);
// An earlier run lives inside its group, so its hints say so.
const earlierHint = (key) => t(`table.earlierHint.${key}`);

// The primary control next to "More" -- Edit for a live row, otherwise
// whichever action a cancelled row is most likely to want next. Only a
// group's head gets one: a cancelled head never has a newer run, because
// that run would be the head instead.
function primaryFor(subscription) {
  if (subscription.status !== "cancelled") return { key: null, label: t("table.edit") };
  if (!subscription.archived_date) return { key: "reactivate", label: menuLabel("reactivate") };
  return { key: "unarchive", label: menuLabel("unarchive") };
}

// The "More" menu's contents -- never including whichever action is already
// the primary control, so nothing appears twice.
function menuKeysFor(subscription) {
  if (subscription.status !== "cancelled") return ["cancel", "delete"];
  if (!subscription.archived_date) return ["archive", "delete"];
  return ["reactivate", "delete"];
}

// An earlier run can't be reactivated while a newer run exists (the backend
// refuses it), so it only ever gets archiving and deleting.
function earlierMenuKeys(run) {
  return [run.archived_date ? "unarchive" : "archive", "delete"];
}

const runsLabel = (n) => t("table.earlierRuns", { n });

// "2026-09-04" -> "Sep 2026" ("9/2026" in Finnish), for the lifetime line's
// "since".
function monthYear(iso) {
  const [y, m] = iso.split("-");
  return t("table.monthYear", { month: shortMonthName(Number(m) - 1), monthNumber: Number(m), year: y });
}

// "Lifetime with Netflix: €610.53 across 3 runs since Mar 2022. This run
// €303.81, earlier runs €306.72." The head row's Paid to date is this same
// total, so the line splits it into the shares the rows above it add up to.
// The amount is left out when a run's start, and so what it paid, is unknown.
function LifetimeLine({ group, prefix }) {
  const paid = lifetimePaid(group);
  const since = groupSince(group);
  // Runs in different currencies split in the user's, each "≈".
  const mixed = lifetimeConverted(group);
  const own = Number(mixed ? group.head.paid_total_converted : group.head.paid_total);
  const amount = (value) => (mixed ? approxText(value) : money(value, lifetimeCurrency(group)));
  return (
    <>
      {prefix}
      {paid != null && <>: <strong><PaidAmount group={group} /></strong></>}
      {t("table.lifetimeRuns", { n: group.runs.length })}
      {since && t("table.lifetimeSince", { since: monthYear(since) })}
      {paid != null && t("table.lifetimeSplit", { own: amount(own), earlier: amount(paid - own) })}
    </>
  );
}

// What the Paid to date figure covers, said under it (issue #88). A range for
// anything that has stopped growing, "since" for the rest, and the reason
// when there is no figure or it is still zero.
function paidNote(group) {
  const head = group.head;
  const runs = group.runs.length;
  if (lifetimePaid(group) == null) return t("table.paidUnknownNote");
  if (head.status === "trial" && runs === 1) return t("table.freeTrial");
  if (isScheduled(head) && Number(lifetimePaid(group)) === 0) {
    return t("table.firstCharge", { month: monthYear(head.started_date) });
  }
  const since = monthYear(groupSince(group));
  const stopped = stoppedDate(head);
  if (stopped) {
    const range = { n: runs, since, stopped: monthYear(stopped) };
    return t(runs > 1 ? "table.runsRange" : "table.range", range);
  }
  return runs > 1 ? t("table.runsSince", { n: runs, since }) : t("table.since", { since });
}

// The mobile row's third line: the desktop note, shorter, because the run
// count already sits under the row as "Show N earlier runs".
function MobilePaid({ group }) {
  const paid = lifetimePaid(group);
  if (paid == null) return t("table.mobilePaidUnknown");
  if (paid === 0) return t("table.nothingPaid");
  const since = monthYear(groupSince(group));
  const stopped = stoppedDate(group.head);
  const range = stopped ? t("table.range", { since, stopped: monthYear(stopped) }) : t("table.since", { since });
  return (
    <>
      <strong><PaidAmount group={group} /></strong>{t("table.mobilePaid", { range })}
    </>
  );
}

const COLUMNS = ["name", "category", "status", "cost", "perMonth", "paid", "renewal"];
const columnLabel = (key) => t(`table.col.${key}`);

// Sorting works on groups: every column but one reads the head row, and Paid
// to date is the whole group's total, the figure the row shows.
function sortValue(group, key) {
  const subscription = group.head;
  switch (key) {
    case "category": return (subscription.category || "").toLowerCase();
    case "status": return STATUS_ORDER[subscription.status];
    // Yearly plans are billed in one lump sum, so sorting on the raw cost
    // would rank a $100/yr plan above a $10/mo one; normalising to a monthly
    // figure is the only way the order matches what subscriptions actually
    // cost against each other.
    // In the user's currency, so $20.00 sorts beside €17.05.
    case "cost": return comparable(perMonth(subscription), subscription.currency);
    // Non-charging rows sort together at one end rather than being scattered
    // through the numbers by a cost they are not paying.
    case "perMonth": return subscription.status === "active" && !isScheduled(subscription)
      ? comparable(perMonth(subscription), subscription.currency)
      : -1;
    // null when a run's start is unknown; the comparator puts those last
    // whichever way the list is sorted, since an unknown has no place in an
    // order of amounts.
    case "paid": return lifetimePaid(group) == null ? null : lifetimePaidConverted(group) ?? lifetimePaid(group);
    case "renewal": return subscription.next_renewal_date;
    default: return subscription.name.toLowerCase();
  }
}

// Match one subscription against the list's searchable facts. Each value is
// checked separately, so text from adjacent columns cannot form a false match.
// Dates have both display and ISO forms: users can type "20 Sep 2026" or paste
// "2026-09-20". The caller has already trimmed and lowercased the query.
// A head row passes its group, so the Paid to date it shows is searchable.
function matchesSearch(subscription, query, group = null) {
  if (!query) return true;
  const groupPaid = group && lifetimePaid(group);
  const values = [
    subscription.name,
    subscription.category,
    shownStatus(subscription),
    cycleNote(subscription.billing_cycle),
    money(subscription.cost, subscription.currency),
    // The code finds every plan in a currency: "usd".
    subscription.currency,
    subscription.status === "trial" ? money(0, subscription.currency) : null,
    subscription.status === "active" ? money(perMonth(subscription), subscription.currency) : null,
    subscription.status === "active" && isForeign(subscription.currency)
      ? money(convert(perMonth(subscription), subscription.currency) ?? 0)
      : null,
    subscription.started_date,
    longDate(subscription.started_date),
    subscription.next_renewal_date,
    longDate(subscription.next_renewal_date),
    // Earlier runs show when they were cancelled, so that is searchable too.
    subscription.cancelled_date,
    longDate(subscription.cancelled_date),
    subscription.archived_date ? statusLabel("archived") : null,
    subscription.paid_total == null ? null : money(subscription.paid_total, subscription.currency),
    groupPaid == null ? null : money(groupPaid, lifetimeCurrency(group)),
  ];
  return values.some((value) => value?.toLowerCase().includes(query));
}

// The input is controlled by SubscriptionTable. Both responsive layouts pass
// through the same onChange callback, including the clear button, so they use
// the same query and filtering behavior.
// "/" focuses it from anywhere on the page (Dashboard.jsx), and the
// placeholder says so where there is a keyboard to press it on.
function SubscriptionSearch({ value, onChange, shortcutHint }) {
  return (
    <div className="subscription-search">
      <Search size={16} />
      <input
        type="search"
        className="input subscription-search-input"
        aria-label={t("table.searchLabel")}
        placeholder={t(shortcutHint ? "table.searchPlaceholderKey" : "table.searchPlaceholder")}
        aria-keyshortcuts="/"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" className="subscription-search-clear" aria-label={t("table.clearSearch")} onClick={() => onChange("")}>
          ×
        </button>
      )}
    </div>
  );
}

function SubscriptionTable({
  subscriptions,
  categories,
  sort,
  setSort,
  showEnded,
  setShowEnded,
  showArchived,
  setShowArchived,
  editingId,
  setEditingId,
  onSave,
  onCancelPlan,
  onReactivate,
  onArchive,
  onUnarchive,
  onArchiveAllEnded,
  onDelete,
  onAdd,
  staleId,
  onRefreshStale,
  // Dashboard's "that went through" line (SaveNotice.jsx), shown under the
  // heading on both layouts: most writes move or remove a row in this list.
  notice,
}) {
  // The draft carries the id it belongs to, so a stale one can never be
  // rendered into a different row than the one it was opened from.
  const [draft, setDraft] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  // Mobile-only, and local rather than lifted to Dashboard: which row's
  // detail sheet is open is browsing state, not something anything outside
  // this component needs to know or set (unlike editingId, which the add
  // form's duplicate-name warning also opens from outside).
  const [detailId, setDetailId] = useState(null);
  // Desktop-only: which row's "More" menu is open. At most one at a time --
  // opening a second closes whichever was already open.
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Which groups the user has opened or closed, by group key. A group with no
  // entry here follows the search: it opens when only an earlier run matches.
  // Browsing state only, so it is not kept across reloads.
  const [openGroups, setOpenGroups] = useState({});
  const isMobile = useIsMobile();

  // A failed archive or restore, said on the row it was for. Those two are
  // the only writes this list starts without a dialog in between, so they
  // are the only ones that need somewhere of their own to fail.
  const [actionError, setActionError] = useState(null);

  // The open menu behaves like one: focus moves to its first item, the arrow
  // keys move between items, and Escape or Tab closes it -- Escape handing
  // focus back to the "More" button that opened it.
  useEffect(() => {
    if (menuOpenId == null) return undefined;
    const trigger = document.querySelector(`[data-menu-trigger="${menuOpenId}"]`);
    const items = () => [...document.querySelectorAll(".row-menu [role=menuitem]")];
    items()[0]?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpenId(null);
        trigger?.focus();
        return;
      }
      if (event.key === "Tab") {
        setMenuOpenId(null);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? at + 1 : at - 1;
      list[(next + list.length) % list.length]?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpenId]);

  async function runRowAction(subscription, action) {
    setActionError(null);
    try {
      await action(subscription);
    } catch (err) {
      // A 404 already turned the row into "removed on another device".
      if (err instanceof ApiError && err.status === 404) return;
      setActionError({ id: subscription.id, message: describeWriteError(err) });
    }
  }

  const actionHandlers = {
    cancel: onCancelPlan,
    reactivate: onReactivate,
    archive: (subscription) => runRowAction(subscription, onArchive),
    unarchive: (subscription) => runRowAction(subscription, onUnarchive),
    delete: onDelete,
  };

  // editingId is owned by the parent -- the duplicate-name warning in the add
  // form opens a row from outside this component -- so the draft is filled in
  // from whichever row that id names, rather than at the click. Adjusted
  // during render rather than in an effect: an effect would paint the display
  // row once before swapping it for the inputs.
  const editing = editingId == null ? null : subscriptions.find((s) => s.id === editingId);
  if (editing && (!draft || draft.id !== editingId)) {
    setDraft({
      id: editing.id,
      name: editing.name,
      category: editing.category || "",
      status: editing.status,
      cost: String(editing.cost),
      // Shown, never edited: a run's currency is fixed once it is added.
      currency: editing.currency ?? "EUR",
      billing_cycle: editing.billing_cycle,
      // "" rather than null so the date input stays controlled; a row that
      // genuinely has no start date opens with an empty picker.
      started_date: editing.started_date || "",
      next_renewal_date: editing.next_renewal_date,
    });
    setRowError(null);
  }

  const groups = buildGroups(subscriptions);
  // "Show ended" hides a whole group, and only when its head is cancelled and
  // its paid-for access has run out (issue #53): a plan cancelled last week
  // that still works until the end of the month stays in the list, and the
  // earlier runs of a live plan stay reachable through its disclosure.
  const endedCount = endedGroupCount(groups);
  // Archived is a flag on top of cancelled (TODO.md item 7), not a status of
  // its own, so it gets its own count and its own toggle. It reveals archived
  // heads and archived earlier runs alike, so it counts the archived runs of
  // every group that is on screen -- a live plan with an archived earlier run
  // offers the toggle even while cancelled plans are hidden.
  const archivedCount = groups
    .filter((g) => !accessEnded(g.head) || showEnded)
    .reduce((n, g) => n + g.runs.filter((s) => s.archived_date).length, 0);
  const query = searchQuery.trim().toLowerCase();
  // Apply the existing cancelled/archived visibility switches first. Search
  // narrows only the groups the user has chosen to show, then sorting keeps
  // its usual order within the results.
  const available = groups
    .filter(({ head }) => {
      // Archiving is a deliberate "out of my sight", so an archived plan
      // waits behind both toggles even while its access is still running.
      if (head.status === "cancelled" && head.archived_date) return showEnded && showArchived;
      return !accessEnded(head) || showEnded;
    })
    .map((g) => (showArchived ? g : { ...g, earlier: g.earlier.filter((s) => !s.archived_date) }));
  // A group matches when its head or any of its shown earlier runs does. The
  // matching earlier runs are highlighted, and a group that matched only
  // through one of them opens on its own so the match is on screen.
  const matchedEarlier = new Set();
  const autoOpen = new Set();
  const visible = available
    .filter((g) => {
      if (!query) return true;
      const headHit = matchesSearch(g.head, query, g);
      const hits = g.earlier.filter((s) => matchesSearch(s, query));
      hits.forEach((s) => matchedEarlier.add(s.id));
      if (hits.length && !headHit) autoOpen.add(g.key);
      return headHit || hits.length > 0;
    })
    // Sorting moves whole groups; the earlier runs travel with their head.
    .sort((ga, gb) => {
      const a = ga.head;
      const b = gb.head;
      // Ended plans go last whichever way the list is sorted: with Show
      // ended on, their past renewal dates would otherwise put them first
      // under the default sort, above every plan that still charges.
      const ended = Number(accessEnded(a)) - Number(accessEnded(b));
      if (ended) return ended;
      const direction = sort.dir === "desc" ? -1 : 1;
      const va = sortValue(ga, sort.key);
      const vb = sortValue(gb, sort.key);
      // An unknown figure goes last both ways, the same as ended plans.
      const unknown = Number(va == null) - Number(vb == null);
      if (unknown) return unknown;
      if (va < vb) return -direction;
      if (va > vb) return direction;
      return a.name.localeCompare(b.name);
    });
  const isOpen = (g) => g.earlier.length > 0 && (openGroups[g.key] ?? autoOpen.has(g.key));
  // Groups of one get a spacer where the disclosure would be, so names line
  // up -- but only when some row actually has a disclosure to line up with.
  const anyDisclosure = visible.some((g) => g.earlier.length > 0);

  function toggleGroup(group) {
    setOpenGroups({ ...openGroups, [group.key]: !isOpen(group) });
    setMenuOpenId(null);
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
    setRowError(null);
  }

  // A new query may remove an open row from the results. Close its editor and
  // action menu before React renders the filtered list with the new query.
  function updateSearch(value) {
    setSearchQuery(value);
    closeEditor();
    setMenuOpenId(null);
  }

  const searchBox = <SubscriptionSearch value={searchQuery} onChange={updateSearch} shortcutHint={!isMobile} />;

  // Offered only while the ended plans are on screen, since those are what it
  // empties. A cancelled plan that still has access is left alone. Undo is in the notice it leaves (Dashboard.jsx).
  async function archiveAllEnded() {
    setArchivingAll(true);
    closeEditor();
    setMenuOpenId(null);
    try {
      await onArchiveAllEnded();
    } finally {
      setArchivingAll(false);
    }
  }
  const archiveAllButton = (className) =>
    showEnded && endedCount > 0 && (
      <button type="button" className={className} disabled={archivingAll} onClick={archiveAllEnded}>
        {t("table.archiveAllEnded", { n: endedCount })}
      </button>
    );
  const listCount = query ? t("table.countOf", { shown: visible.length, total: available.length }) : visible.length;
  const noResults = query && visible.length === 0 && (
    <div className="subscription-search-empty">
      <span>{t("table.noResults", { query: searchQuery.trim() })}</span>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => updateSearch("")}>
        {t("table.clearSearch")}
      </button>
    </div>
  );

  // Entering a sort, or toggling cancelled visibility, closes any open editor:
  // the row would otherwise move out from under the cursor mid-edit.
  function sortBy(key) {
    const first = DESC_FIRST.has(key) ? "desc" : "asc";
    setSort({ key, dir: sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : first });
    closeEditor();
    setMenuOpenId(null);
  }

  // Enter in any field of the edit row (or the mobile edit sheet) saves it,
  // the way it would in a form. There is no <form> to do this natively: one
  // cannot wrap a table row. Buttons keep their own Enter.
  function saveOnEnter(subscription) {
    return (event) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      if (!event.target.matches("input, select")) return;
      event.preventDefault();
      save(subscription);
    };
  }

  async function save(subscription) {
    if (busy) return;
    // Checked here first so the common mistakes read as the design's own copy
    // rather than as Pydantic's. A server rejection is then the rare second
    // line of defence, and its message is shown verbatim with a next step.
    if (!draft.name.trim()) {
      setRowError(t("table.nameRequired"));
      return;
    }
    const costError = costProblem(draft.cost);
    if (costError) {
      setRowError(t("table.costError", { problem: costError }));
      return;
    }
    setBusy(true);
    try {
      await onSave(subscription.id, {
        name: draft.name.trim(),
        category: draft.category || null,
        status: draft.status,
        cost: parseAmount(draft.cost),
        billing_cycle: draft.billing_cycle,
        // Cleared on purpose means "start unknown", which is a real state the
        // spend summary handles (it counts the plan as always having run), so
        // it is sent as null rather than quietly left as it was.
        started_date: draft.started_date || null,
        next_renewal_date: draft.next_renewal_date,
      });
      closeEditor();
    } catch (err) {
      // Save with an error keeps the row open -- closing it would discard the
      // edit the user still has to fix.
      setRowError(describeWriteError(err, t("table.notSaved")));
    } finally {
      setBusy(false);
    }
  }

  // --- mobile: the table becomes a list (handoff section 14) ---
  //
  // Everything above this point -- visible, sort, draft, save, closeEditor --
  // is shared with the desktop branch below; only how it's rendered differs.
  // editingId (Dashboard-owned) doubles as "which row's edit sheet is open"
  // here, the same id the desktop branch uses for its inline row -- that's
  // what lets the add form's "Edit that subscription instead" link work
  // identically on both layouts. detailId is local: which row's detail sheet
  // is open is pure browsing state nothing outside this component needs.
  if (isMobile) {
    const detailSub = detailId == null ? null : subscriptions.find((s) => s.id === detailId);
    const detailGroup = detailSub && groups.find((g) => g.runs.includes(detailSub));
    const detailIsEarlier = Boolean(detailGroup && detailGroup.head !== detailSub);
    const detailKeys = !detailSub
      ? []
      : detailIsEarlier
        ? earlierMenuKeys(detailSub)
        : [primaryFor(detailSub).key, ...menuKeysFor(detailSub)].filter(Boolean);
    const detailHints = detailIsEarlier ? earlierHint : menuHint;
    const openDetailActions = (subscription) => (fn) => () => {
      setDetailId(null);
      fn(subscription);
    };

    const draftPerMonth =
      draft && draft.status === "active" && parseAmount(draft.cost) > 0
        ? money(perMonth({ cost: parseAmount(draft.cost), billing_cycle: draft.billing_cycle }), draft.currency)
        : "—";

    const mobileActionError = (id) =>
      actionError?.id === id && (
        <p role="alert" className="mobile-row-error">
          <TriangleAlert size={16} />
          <span>{actionError.message}</span>
        </p>
      );

    return (
      <section id="all" className="table-section">
        <div className="section-head">
          <h2 className="eyebrow">{t("table.heading", { count: listCount })}</h2>
        </div>

        {notice}

        {searchBox}

        {archivedCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-small mobile-list-toggle"
            onClick={() => { setShowArchived(!showArchived); closeEditor(); }}
          >
            {showArchived ? t("table.hideArchived") : t("table.showArchived", { n: archivedCount })}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small mobile-list-toggle"
          onClick={() => { setShowEnded(!showEnded); closeEditor(); }}
        >
          {showEnded ? t("table.hideEnded") : t("table.showEnded", { n: endedCount })}
        </button>
        {archiveAllButton("btn btn-ghost btn-small mobile-list-toggle")}

        <div className="sort-chips" role="group" aria-label={t("table.sortGroup")}>
          {CHIPS.map((chip) => {
            const on = sort.key === chip.key;
            const label = chip.label();
            return (
              <button
                key={chip.key}
                type="button"
                className={on ? "sort-chip on" : "sort-chip"}
                aria-pressed={on}
                aria-label={on ? t(sort.dir === "asc" ? "table.chipAsc" : "table.chipDesc", { label }) : undefined}
                onClick={() => sortBy(chip.key)}
              >
                {label}
                {on && <span aria-hidden="true">{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
              </button>
            );
          })}
        </div>

        <div className="mobile-list">
          {noResults}
          {visible.map((group) => {
            const subscription = group.head;
            if (subscription.id === staleId) {
              return (
                <div key={group.key} className="mobile-row-stale">
                  <TriangleAlert />
                  <span>
                    <span>{t("table.stale", { name: subscription.name })}</span>
                    <button type="button" className="btn btn-ghost btn-small" onClick={onRefreshStale}>
                      {t("table.refresh")}
                    </button>
                  </span>
                </div>
              );
            }
            const cancelled = subscription.status === "cancelled";
            const ended = accessEnded(subscription);
            const archived = Boolean(subscription.archived_date);
            const earlierCount = group.earlier.length;
            const open = isOpen(group);
            return (
              <Fragment key={group.key}>
              <button
                type="button"
                className={["mobile-row", ended && "cancelled", earlierCount > 0 && "has-runs"]
                  .filter(Boolean).join(" ")}
                // A cancelled row has nothing to edit inline -- its sheet is
                // the read-only facts plus Manage plan. Anything else opens
                // straight into the edit sheet; a "tap to view, tap Edit to
                // edit" detour was two taps for the one thing most people
                // are here for.
                onClick={() => (cancelled ? setDetailId(subscription.id) : setEditingId(subscription.id))}
              >
                <MonoTile name={subscription.name} dim={ended} />
                <span className="mobile-row-main">
                  <span className="mobile-row-title">
                    <span className="mobile-row-name">{subscription.name}</span>
                    {(subscription.status !== "active" || isScheduled(subscription)) && (
                      <span className={STATUS_TAG[subscription.status]}>{shownStatus(subscription)}</span>
                    )}
                    {archived && <span className="tag tag-outline">{statusLabel("archived")}</span>}
                  </span>
                  <span className="mobile-row-meta">{mobileMeta(subscription)}</span>
                  <span className="mobile-row-paid"><MobilePaid group={group} /></span>
                </span>
                <span className="mobile-row-cost">
                  <span className="mobile-row-amount">
                    {money(subscription.status === "trial" ? 0 : subscription.cost, subscription.currency)}
                  </span>
                  <span className="mobile-row-permonth">{mobilePerMonthNote(subscription)}</span>
                </span>
                <ChevronRight size={16} />
              </button>
              {mobileActionError(subscription.id)}
              {earlierCount > 0 && (
                <button
                  type="button"
                  className="mobile-runs-toggle"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group)}
                >
                  <ChevronRight size={14} />
                  {t(open ? "table.hideRuns" : "table.showRuns", { runs: runsLabel(earlierCount) })}
                </button>
              )}
              {open && (
                <div className="mobile-earlier">
                  {group.earlier.map((run) => (
                    <Fragment key={run.id}>
                    <button
                      type="button"
                      className={matchedEarlier.has(run.id) ? "mobile-row match" : "mobile-row"}
                      onClick={() => setDetailId(run.id)}
                    >
                      <span className="mobile-row-main">
                        <span className="mobile-row-title">
                          <span className="mobile-row-name">
                            {t("table.runOf", { n: runNumber(group, run), total: group.runs.length })}
                          </span>
                          {run.archived_date && <span className="tag tag-outline">{statusLabel("archived")}</span>}
                        </span>
                        <span className="mobile-row-meta">
                          {run.started_date ? longDate(run.started_date) : "—"}
                          {" – "}
                          {run.cancelled_date ? longDate(run.cancelled_date) : "—"}
                        </span>
                      </span>
                      <span className="mobile-row-cost">
                        <span className="mobile-row-amount">{money(run.cost, run.currency)}</span>
                        <span className="mobile-row-permonth">
                          {run.paid_total == null
                            ? cycleNote(run.billing_cycle)
                            : t("table.paidAmount", { amount: money(run.paid_total, run.currency) })}
                        </span>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    {mobileActionError(run.id)}
                    </Fragment>
                  ))}
                  <div className="mobile-lifetime">
                    <LifetimeLine group={group} prefix={t("table.lifetime")} />
                  </div>
                </div>
              )}
              </Fragment>
            );
          })}
        </div>

        {detailSub && !editing && (
          <Sheet
            title={detailSub.name}
            header={
              <div className="row-detail-head">
                <MonoTile name={detailSub.name} dim={accessEnded(detailSub)} />
                <p className="row-detail-name">{detailSub.name}</p>
              </div>
            }
            onClose={() => setDetailId(null)}
            className="dialog-detail"
          >
            <div className="row-detail-facts">
              {[
                [
                  columnLabel("status"),
                  shownStatus(detailSub) + (detailSub.archived_date ? ` · ${statusLabel("archived")}` : ""),
                ],
                [columnLabel("category"), detailSub.category || "—"],
                [
                  columnLabel("cost"),
                  `${money(detailSub.status === "trial" ? 0 : detailSub.cost, detailSub.currency)} ${cycleNote(detailSub.billing_cycle)}`,
                ],
                [t("fx.billedIn"), `${currencyName(detailSub.currency)} (${detailSub.currency})`],
                [
                  columnLabel("perMonth"),
                  detailSub.status === "active" ? money(perMonth(detailSub), detailSub.currency) : "—",
                ],
                [
                  detailSub.status !== "cancelled"
                    ? columnLabel("renewal")
                    : t(accessEnded(detailSub) ? "table.fact.accessEnded" : "table.fact.accessEnds"),
                  detailSub.status === "cancelled" && !detailSub.cancelled_date
                    ? "—"
                    : longDate(detailSub.next_renewal_date),
                ],
                [
                  t("table.fact.countsToward"),
                  t(detailSub.status === "active" && !isScheduled(detailSub) ? "table.fact.yourTotals" : "table.fact.nothingNow"),
                ],
                // The list shows only the month it started; the day is here.
                [t("table.fact.started"), detailSub.started_date ? longDate(detailSub.started_date) : "—"],
                // A head row's sheet repeats the row's Paid to date, the whole
                // group's total, and splits out this run's share when there
                // are others. An earlier run's sheet is about that run alone.
                ...(detailIsEarlier
                  ? detailSub.paid_total == null ? [] : [[t("table.fact.paid"), money(detailSub.paid_total, detailSub.currency)]]
                  : [
                      [
                        columnLabel("paid"),
                        lifetimePaid(detailGroup) == null
                          ? t("table.fact.paidUnknown")
                          : `${lifetimeConverted(detailGroup) ? "≈ " : ""}${money(lifetimePaid(detailGroup), lifetimeCurrency(detailGroup))} · ${paidNote(detailGroup)}`,
                      ],
                      ...(detailGroup.runs.length > 1 && detailSub.paid_total != null
                        ? [[t("table.fact.thisRun"), money(detailSub.paid_total, detailSub.currency)]]
                        : []),
                    ]),
                ...(detailIsEarlier
                  ? [[t("table.fact.run"), t("table.runNofM", { n: runNumber(detailGroup, detailSub), total: detailGroup.runs.length })]]
                  : []),
              ].map(([label, value]) => (
                <div className="row-detail-fact" key={label}>
                  <span className="field-label">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <div className="manage-plan">
              <span className="field-label">{t("table.managePlan")}</span>
              <div className="manage-plan-list">
                {/* This sheet only ever opens for a cancelled row (see the
                    row buttons above): a cancelled head or an earlier run.
                    A head's primary action -- Reactivate, or Restore to list
                    once archived -- has no button of its own up top; it's
                    just the first item here instead. */}
                {detailKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === "delete" ? "manage-plan-item destructive" : "manage-plan-item"}
                    onClick={openDetailActions(detailSub)(actionHandlers[key])}
                  >
                    <span className="manage-plan-label">{menuLabel(key)}</span>
                    <span className="manage-plan-hint">{detailHints(key)}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sheet>
        )}

        {editing && draft && draft.id === editingId && (
          <Sheet title={t("table.editTitle", { name: editing.name })} onClose={closeEditor} className="dialog-sheet-edit">
            <div className="sheet-fields" onKeyDown={saveOnEnter(editing)}>
              <label className="field">
                <span className="field-label">{t("table.field.service")}</span>
                <input
                  className="input"
                  type="text"
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <div className="sheet-row">
                <label className="field">
                  <span className="field-label">{columnLabel("cost")}</span>
                  <span className="money-locked">
                    <input
                      className="input tnum"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={draft.cost}
                      onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                    />
                    <span className="code" aria-hidden="true">{draft.currency}</span>
                  </span>
                  <span className="field-hint">{t("fx.lockedShort")}</span>
                </label>
                <label className="field">
                  <span className="field-label">{t("table.field.cycle")}</span>
                  <select
                    className="input"
                    value={draft.billing_cycle}
                    onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
                  >
                    <option value="monthly">{cycleLabel("monthly")}</option>
                    <option value="quarterly">{cycleLabel("quarterly")}</option>
                    <option value="yearly">{cycleLabel("yearly")}</option>
                  </select>
                </label>
              </div>
              <div className="sheet-row">
                <label className="field">
                  <span className="field-label">{columnLabel("category")}</span>
                  <select
                    className="input"
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  >
                    <option value="">{t("table.noCategory")}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{columnLabel("status")}</span>
                  <select
                    className="input"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  >
                    <option value="active">{statusLabel("active")}</option>
                    <option value="trial">{statusLabel("trial")}</option>
                    <option value="paused">{statusLabel("paused")}</option>
                  </select>
                </label>
              </div>
              <div className="sheet-row">
                <label className="field">
                  <span className="field-label">{t("table.field.started")}</span>
                  <input
                    className="input tnum"
                    type="date"
                    value={draft.started_date}
                    onChange={(e) => setDraft({ ...draft, started_date: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{columnLabel("renewal")}</span>
                  <input
                    className="input tnum"
                    type="date"
                    value={draft.next_renewal_date}
                    onChange={(e) => setDraft({ ...draft, next_renewal_date: e.target.value })}
                  />
                </label>
              </div>
              <p className="sheet-hint">{t("table.perMonthHint", { amount: draftPerMonth })}</p>
            </div>
            {rowError && (
              <p role="alert" className="dialog-error">
                <TriangleAlert size={16} />
                <span>{rowError}</span>
              </p>
            )}
            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => save(editing)}
              >
                {t("table.saveChanges")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                {t("table.discard")}
              </button>
            </div>
            <div className="manage-plan">
              <span className="field-label">{t("table.managePlan")}</span>
              <div className="manage-plan-list">
                {menuKeysFor(editing).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === "delete" ? "manage-plan-item destructive" : "manage-plan-item"}
                    onClick={() => { closeEditor(); actionHandlers[key](editing); }}
                  >
                    <span className="manage-plan-label">{menuLabel(key)}</span>
                    <span className="manage-plan-hint">{menuHint(key)}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sheet>
        )}
      </section>
    );
  }

  // The group's own row: its head run, as display, inline editor or stale
  // message.
  function headRows(group) {
    const subscription = group.head;
    // A record removed on another device is replaced, not annotated:
    // leaving the row in place would let it be edited further.
    if (subscription.id === staleId) {
      return (
        <tr key={subscription.id} className="row-message">
          <td colSpan={8}>
            <span className="row-stale-inner">
              <TriangleAlert />
              <span>{t("table.stale", { name: subscription.name })}</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={onRefreshStale}>
                {t("table.refresh")}
              </button>
            </span>
          </td>
        </tr>
      );
    }

    if (subscription.id === editingId && draft && draft.id === editingId) {
      const draftPerMonth =
        draft.status === "active" && parseAmount(draft.cost) > 0
          ? money(perMonth({ cost: parseAmount(draft.cost), billing_cycle: draft.billing_cycle }), draft.currency)
          : "—";
      return (
        <Fragment key={subscription.id}>
        <tr className="row-editing" onKeyDown={saveOnEnter(subscription)}>
          <td>
            <span className="row-name">
              {disclosure(group)}
              <MonoTile name={draft.name} />
              <input
                className="input"
                type="text"
                aria-label={t("table.field.service")}
                maxLength={NAME_MAX}
                autoComplete="off"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </span>
          </td>
          <td>
            <select
              className="input"
              aria-label={columnLabel("category")}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              <option value="">{t("table.noCategory")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>{category.name}</option>
              ))}
            </select>
          </td>
          <td>
            {/* Cancelling is done through the action, not this
                dropdown: it archives a record and deserves a confirm. */}
            <select
              className="input"
              aria-label={columnLabel("status")}
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="active">{statusLabel("active")}</option>
              <option value="trial">{statusLabel("trial")}</option>
              <option value="paused">{statusLabel("paused")}</option>
            </select>
          </td>
          <td>
            <span className="edit-cost">
              {/* The currency rides inside the field's edge as text: fixed
                  once added, and the list guide says why. */}
              <span className="money-locked">
                <input
                  className="input tnum"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={t("fx.costIn", { name: currencyName(draft.currency) })}
                  title={t("fx.locked")}
                  value={draft.cost}
                  onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                />
                <span className="code" aria-hidden="true">{draft.currency}</span>
              </span>
              <select
                className="input cycle-select"
                aria-label={t("table.field.cycle")}
                value={draft.billing_cycle}
                onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
              >
                <option value="monthly">{cycleLabel("monthly")}</option>
                <option value="quarterly">{cycleLabel("quarterly")}</option>
                <option value="yearly">{cycleLabel("yearly")}</option>
              </select>
            </span>
          </td>
          <td className="edit-per-month">{draftPerMonth}</td>
          <td>
            <input
              className="input tnum"
              type="date"
              aria-label={t("table.field.started")}
              value={draft.started_date}
              onChange={(e) => setDraft({ ...draft, started_date: e.target.value })}
            />
          </td>
          <td>
            <input
              className="input tnum"
              type="date"
              aria-label={columnLabel("renewal")}
              value={draft.next_renewal_date}
              onChange={(e) => setDraft({ ...draft, next_renewal_date: e.target.value })}
            />
          </td>
          <td className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => save(subscription)}
            >
              {t("table.save")}
            </button>
            {/* "Discard", as in the mobile edit sheet -- never "Cancel", which
                would sit right next to the "Mark as cancelled" action. */}
            <button type="button" className="btn btn-ghost btn-small" onClick={closeEditor}>
              {t("table.discard")}
            </button>
          </td>
        </tr>
        {rowError && (
          <tr className="row-message row-error">
            <td colSpan={8}>
              <span role="alert" className="row-message-inner">
                <TriangleAlert />
                <span>{rowError}</span>
              </span>
            </td>
          </tr>
        )}
        </Fragment>
      );
    }

    const cancelled = subscription.status === "cancelled";
    // Only an ended plan reads as history. One still inside its paid-for
    // term is set in full ink: it is a plan the user can still use.
    const ended = accessEnded(subscription);
    const archived = Boolean(subscription.archived_date);
    const trial = subscription.status === "trial";
    const primary = primaryFor(subscription);
    return (
      <tr
        key={subscription.id}
        className={[ended && "row-cancelled", isOpen(group) && "row-group-open"].filter(Boolean).join(" ") || undefined}
      >
        <td>
          <span className="row-name">
            {disclosure(group)}
            <MonoTile name={subscription.name} dim={ended} />
            <span className="name-stack">
              <span>{subscription.name}</span>
              {/* A second, larger target for the same toggle. Out of the
                  tab order: the chevron already is the keyboard control. */}
              {group.earlier.length > 0 && (
                <button type="button" className="runs-link" tabIndex={-1} onClick={() => toggleGroup(group)}>
                  {runsLabel(group.earlier.length)}
                </button>
              )}
            </span>
          </span>
        </td>
        <td>{subscription.category}</td>
        <td>
          {/* Archived is a flag on top of cancelled, not a status of
              its own (TODO.md item 7), so it rides along as a second
              tag rather than replacing "Cancelled". */}
          <span className="status-tags">
            <span className={STATUS_TAG[subscription.status]}>{shownStatus(subscription)}</span>
            {archived && <span className="tag tag-outline">{statusLabel("archived")}</span>}
          </span>
        </td>
        <td className="tnum">
          <span>{money(trial ? 0 : subscription.cost, subscription.currency)}</span>
          <span className="sub-note">
            {trial ? thenNote(subscription) : <CostNote subscription={subscription} />}
          </span>
        </td>
        <td className="tnum">
          <PerMonthCell subscription={subscription} />
        </td>
        <td className="tnum">
          {/* The whole group's total, set like the Cost and Per month
              figures beside it, with a note saying what span it covers. A
              row restored from a backup written before started_date
              existed has no honest total, so it says so rather than
              showing a partial sum. */}
          <span><PaidAmount group={group} /></span>
          <span className="sub-note">
            {paidNote(group)}
            {/* A service billed in another currency: what it came to in the
                user's, each charge at its own day's rate. */}
            {!lifetimeConverted(group) && isForeign(lifetimeCurrency(group)) && lifetimePaid(group) > 0 && (
              <>
                {" · "}
                <Converted amount={lifetimePaidConverted(group)} className="" />
              </>
            )}
          </span>
        </td>
        <td className="tnum">
          {/* A cancelled plan is never charged again -- billing is
              upfront, so the date is when the term already paid for
              runs out, not a charge still to come. Without a
              cancellation date (a version 1 backup restores into
              exactly that) the server has nothing to measure from and
              rolls the anchor off today, which would show a renewal
              that is never going to happen; an em dash is the honest
              answer there. */}
          <span>
            {cancelled && !subscription.cancelled_date
              ? "—"
              : longDate(subscription.next_renewal_date)}
          </span>
          <span className="sub-note">
            {trial
              ? t("table.trialEnds")
              : subscription.status === "paused"
                ? t("table.resumes")
                : cancelled
                  ? subscription.cancelled_date
                    ? t(ended ? "table.accessEnded" : "table.accessEnds")
                    : ""
                  : ""}
          </span>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t("table.primaryAria", { action: primary.label, name: subscription.name })}
            onClick={
              primary.key
                ? () => actionHandlers[primary.key](subscription)
                : () => setEditingId(subscription.id)
            }
          >
            {primary.label}
          </button>
          {moreMenu(subscription, menuKeysFor(subscription), menuHint, t("table.moreFor", { name: subscription.name }))}
        </td>
      </tr>
    );
  }

  // The chevron that opens a group, or a spacer that keeps a group of one
  // aligned with it.
  function disclosure(group) {
    const n = group.earlier.length;
    if (n === 0) return anyDisclosure ? <span className="disclosure-spacer" /> : null;
    const open = isOpen(group);
    return (
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-label={t(open ? "table.hideRunsOf" : "table.showRunsOf", { runs: runsLabel(n), name: group.head.name })}
        onClick={() => toggleGroup(group)}
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  // "More ▾" and the menu it opens, for a head row or an earlier run.
  function moreMenu(subscription, keys, hints, label) {
    const menuOpen = menuOpenId === subscription.id;
    return (
      <>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={label}
          data-menu-trigger={subscription.id}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpenId(menuOpen ? null : subscription.id)}
        >
          {t("table.more")}
        </button>
        {menuOpen && (
          <div className="row-menu" role="menu" aria-label={label}>
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                className={key === "delete" ? "row-menu-item destructive" : "row-menu-item"}
                onClick={() => {
                  // Focus goes back to "More" before the menu closes, so a
                  // dialog this opens has it to return to afterwards.
                  document.querySelector(`[data-menu-trigger="${subscription.id}"]`)?.focus();
                  setMenuOpenId(null);
                  actionHandlers[key](subscription);
                }}
              >
                <span className="row-menu-label">{menuLabel(key)}</span>
                <span className="row-menu-hint">{hints(key)}</span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  // The row under a row whose archive or restore just failed.
  function actionErrorRow(id) {
    if (actionError?.id !== id) return null;
    return (
      <tr className="row-message row-error">
        <td colSpan={8}>
          <span role="alert" className="row-message-inner">
            <TriangleAlert />
            <span>{actionError.message}</span>
          </span>
        </td>
      </tr>
    );
  }

  // An open group's earlier runs, newest first, closed by the lifetime row.
  // Each run shows the price and dates it had then; every earlier run is
  // cancelled, so its last date is when it stopped rather than a renewal.
  function earlierRows(group) {
    return (
      <>
        {group.earlier.map((run) => (
          <Fragment key={run.id}>
          <tr className={matchedEarlier.has(run.id) ? "row-earlier match" : "row-earlier"}>
            <td>
              <span className="earlier-name">
                <span className="name-stack">
                  <span>{t("table.earlierRun")}</span>
                  <span className="sub-note">{t("table.runOf", { n: runNumber(group, run), total: group.runs.length })}</span>
                </span>
              </span>
            </td>
            <td />
            <td>
              <span className="status-tags">
                <span className={STATUS_TAG[run.status]}>{statusLabel(run.status)}</span>
                {run.archived_date && <span className="tag tag-outline">{statusLabel("archived")}</span>}
              </span>
            </td>
            <td className="tnum">
              <span>{money(run.cost, run.currency)}</span>
              <span className="sub-note">{cycleNote(run.billing_cycle)}</span>
            </td>
            <td className="tnum">—</td>
            <td className="tnum">
              <span>{run.paid_total == null ? "—" : money(run.paid_total, run.currency)}</span>
              <span className="sub-note">
                {run.started_date ? monthYear(run.started_date) : "—"}
                {" – "}
                {run.cancelled_date ? monthYear(run.cancelled_date) : "—"}
              </span>
            </td>
            <td className="tnum">
              <span>{run.cancelled_date ? longDate(run.cancelled_date) : "—"}</span>
              <span className="sub-note">{t("table.cancelledNote")}</span>
            </td>
            <td className="row-actions">
              {moreMenu(
                run,
                earlierMenuKeys(run),
                earlierHint,
                t("table.moreForRun", { n: runNumber(group, run), name: group.head.name }),
              )}
            </td>
          </tr>
          {actionErrorRow(run.id)}
          </Fragment>
        ))}
        <tr className="row-lifetime">
          <td colSpan={8}>
            <LifetimeLine group={group} prefix={t("table.lifetimeWith", { name: group.head.name })} />
          </td>
        </tr>
      </>
    );
  }

  return (
    <section id="all" className="table-section">
      <div className="section-head">
        <h2 className="eyebrow">{t("table.heading", { count: listCount })}</h2>
        <span className="table-actions">
          {searchBox}
          {archivedCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => { setShowArchived(!showArchived); closeEditor(); }}
            >
              {showArchived ? t("table.hideArchived") : t("table.showArchived", { n: archivedCount })}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => { setShowEnded(!showEnded); closeEditor(); }}
          >
            {showEnded ? t("table.hideEnded") : t("table.showEnded", { n: endedCount })}
          </button>
          {archiveAllButton("btn btn-ghost btn-small")}
          <button type="button" className="btn btn-primary" onClick={onAdd} title={t("table.addTitle")} aria-keyshortcuts="n">
            {t("table.add")}
          </button>
        </span>
      </div>

      {notice}

      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((key) => {
              const column = { key, label: columnLabel(key) };
              const on = sort.key === column.key;
              const asc = sort.dir === "asc";
              return (
                <th key={column.key} scope="col" aria-sort={on ? (asc ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={on ? "sort-button on" : "sort-button"}
                    onClick={() => sortBy(column.key)}
                    title={
                      !on
                        ? t("table.sortBy", { label: column.label })
                        : DESC_FIRST.has(column.key)
                          ? t(asc ? "table.sortedLeast" : "table.sortedMost")
                          : t(asc ? "table.sortedAsc" : "table.sortedDesc")
                    }
                  >
                    <span>{column.label}</span>
                    {/* aria-sort on the th says which way; the arrow is for the eye. */}
                    <span className="sort-arrow" aria-hidden="true">{on ? (asc ? "↑" : "↓") : "↕"}</span>
                  </button>
                </th>
              );
            })}
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {noResults && <tr><td colSpan={8}>{noResults}</td></tr>}
          {visible.map((group) => (
            <Fragment key={group.key}>
              {headRows(group)}
              {actionErrorRow(group.head.id)}
              {isOpen(group) && earlierRows(group)}
            </Fragment>
          ))}
        </tbody>
      </table>
      {/* A fixed, transparent scrim rather than a per-row blur backdrop --
          one open menu at a time, closed by a click anywhere outside it. */}
      {menuOpenId != null && <div className="menu-scrim" onClick={() => setMenuOpenId(null)} />}
    </section>
  );
}

export default SubscriptionTable;
