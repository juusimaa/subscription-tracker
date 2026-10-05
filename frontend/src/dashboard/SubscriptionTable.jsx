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
import { SHORT_MONTHS, costProblem, cycleSuffix, longDate, money, parseAmount, perMonth, todayISO } from "../format";
import { NAME_MAX } from "./AddForm";
import { useIsMobile } from "../useMediaQuery";
import { buildGroups, cancelledGroupCount, groupSince, lifetimePaid, runNumber } from "./groups";

// The sort chip row (mobile only) offers five of the desktop table's seven
// columns, in the order the handoff lists them -- "Started" and "Per month"
// are left out, the same way the mobile row shows a combined cost line
// instead of a separate Per month column.
const CHIPS = [
  { key: "renewal", label: "Renewal" },
  { key: "name", label: "Name" },
  { key: "cost", label: "Cost" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];

// The mobile row's one meta line combines category with whatever the
// desktop table says in two places (the Next renewal cell's date and its
// sub-note): "Entertainment · 04 Sep 2026", "Work · access ends 30 Jul 2026".
function mobileMeta(subscription) {
  const cancelled = subscription.status === "cancelled";
  const trial = subscription.status === "trial";
  const paused = subscription.status === "paused";
  let dateText;
  if (cancelled && !subscription.cancelled_date) dateText = "—";
  else if (cancelled) dateText = `access ends ${longDate(subscription.next_renewal_date)}`;
  else if (paused) dateText = "resumes when unpaused";
  else if (trial) dateText = `trial ends ${longDate(subscription.next_renewal_date)}`;
  else dateText = longDate(subscription.next_renewal_date);
  return subscription.category ? `${subscription.category} · ${dateText}` : dateText;
}

function mobilePerMonthNote(subscription) {
  if (subscription.status === "trial") {
    return `then ${money(subscription.cost)}${cycleSuffix(subscription.billing_cycle)}`;
  }
  if (subscription.status === "active") return `${money(perMonth(subscription))}/mo`;
  return subscription.billing_cycle;
}

const STATUS = {
  active: { label: "Active", tag: "tag tag-neutral" },
  trial: { label: "Trial", tag: "tag tag-accent" },
  paused: { label: "Paused", tag: "tag tag-outline" },
  cancelled: { label: "Cancelled", tag: "tag tag-outline" },
};

// Fixed, not alphabetical: the order is how far along a subscription is
// towards costing nothing, which is the thing worth grouping by.
const STATUS_ORDER = { active: 0, trial: 1, paused: 2, cancelled: 3 };

function isScheduled(subscription) {
  return subscription.status === "active" && subscription.started_date > todayISO();
}

// Every row's secondary actions, described rather than left as bare verbs.
const MENU_LABELS = {
  cancel: "Cancel plan",
  reactivate: "Reactivate",
  archive: "Archive",
  unarchive: "Restore to list",
  delete: "Delete permanently",
};
const MENU_HINTS = {
  cancel: "Stops counting toward your totals. The record stays.",
  reactivate: "Starts a new run; the paid history stays unchanged.",
  archive: "Hides it from the list. Your totals don't change.",
  unarchive: "Puts it back among your cancelled plans.",
  delete: "Removes it and its history. No undo.",
};
// An earlier run lives inside its group, so its hints say so.
const EARLIER_HINTS = {
  archive: "Hides this run inside the group. Your totals don't change.",
  unarchive: "Shows this run inside the group again.",
  delete: "Removes this run and what it cost. No undo.",
};

// The primary control next to "More" -- Edit for a live row, otherwise
// whichever action a cancelled row is most likely to want next. Only a
// group's head gets one: a cancelled head never has a newer run, because
// that run would be the head instead.
function primaryFor(subscription) {
  if (subscription.status !== "cancelled") return { key: null, label: "Edit" };
  if (!subscription.archived_date) return { key: "reactivate", label: "Reactivate" };
  return { key: "unarchive", label: "Restore to list" };
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

const runsLabel = (n) => `${n} earlier ${n === 1 ? "run" : "runs"}`;

// "2026-09-04" -> "Sep 2026", for the lifetime line's "since".
function monthYear(iso) {
  const [y, m] = iso.split("-");
  return `${SHORT_MONTHS[Number(m) - 1]} ${y}`;
}

// "Lifetime with Netflix: €610.53 across 3 runs since Mar 2022". The amount
// is left out when a run's start, and so what it paid, is unknown.
function LifetimeLine({ group, prefix }) {
  const paid = lifetimePaid(group);
  const since = groupSince(group);
  return (
    <>
      {prefix}
      {paid != null && <>: <strong>{money(paid)}</strong></>}
      {` across ${group.runs.length} runs`}
      {since && ` since ${monthYear(since)}`}
    </>
  );
}

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "cost", label: "Cost" },
  { key: "perMonth", label: "Per month" },
  { key: "started", label: "Started" },
  { key: "renewal", label: "Next renewal" },
];

function sortValue(subscription, key) {
  switch (key) {
    case "category": return (subscription.category || "").toLowerCase();
    case "status": return STATUS_ORDER[subscription.status];
    // Yearly plans are billed in one lump sum, so sorting on the raw cost
    // would rank a $100/yr plan above a $10/mo one; normalising to a monthly
    // figure is the only way the order matches what subscriptions actually
    // cost against each other.
    case "cost": return perMonth(subscription);
    // Non-charging rows sort together at one end rather than being scattered
    // through the numbers by a cost they are not paying.
    case "perMonth": return subscription.status === "active" && !isScheduled(subscription)
      ? perMonth(subscription)
      : -1;
    // Rows restored from a backup taken before this column existed have no
    // start date; "" groups those together at one end rather than scattering
    // them, the same idea as the -1 above.
    case "started": return subscription.started_date || "";
    case "renewal": return subscription.next_renewal_date;
    default: return subscription.name.toLowerCase();
  }
}

// Match one subscription against the list's searchable facts. Each value is
// checked separately, so text from adjacent columns cannot form a false match.
// Dates have both display and ISO forms: users can type "20 Sep 2026" or paste
// "2026-09-20". The caller has already trimmed and lowercased the query.
function matchesSearch(subscription, query) {
  if (!query) return true;
  const values = [
    subscription.name,
    subscription.category,
    isScheduled(subscription) ? "Scheduled" : STATUS[subscription.status].label,
    subscription.billing_cycle,
    money(subscription.cost),
    subscription.status === "trial" ? money(0) : null,
    subscription.status === "active" ? money(perMonth(subscription)) : null,
    subscription.started_date,
    longDate(subscription.started_date),
    subscription.next_renewal_date,
    longDate(subscription.next_renewal_date),
    // Earlier runs show when they were cancelled, so that is searchable too.
    subscription.cancelled_date,
    longDate(subscription.cancelled_date),
    subscription.archived_date ? "Archived" : null,
  ];
  return values.some((value) => value?.toLowerCase().includes(query));
}

// The input is controlled by SubscriptionTable. Both responsive layouts pass
// through the same onChange callback, including the clear button, so they use
// the same query and filtering behavior.
function SubscriptionSearch({ value, onChange }) {
  return (
    <div className="subscription-search">
      <Search size={16} />
      <input
        type="search"
        className="input subscription-search-input"
        aria-label="Search subscriptions"
        placeholder="Name, cost, date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" className="subscription-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
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
  showCancelled,
  setShowCancelled,
  showArchived,
  setShowArchived,
  editingId,
  setEditingId,
  onSave,
  onCancelPlan,
  onReactivate,
  onArchive,
  onUnarchive,
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
      billing_cycle: editing.billing_cycle,
      // "" rather than null so the date input stays controlled; a row that
      // genuinely has no start date opens with an empty picker.
      started_date: editing.started_date || "",
      next_renewal_date: editing.next_renewal_date,
    });
    setRowError(null);
  }

  const groups = buildGroups(subscriptions);
  // "Show cancelled" hides a whole group, and only when its head is
  // cancelled: the earlier runs of a live plan stay reachable through its
  // disclosure.
  const cancelledCount = cancelledGroupCount(groups);
  // Archived is a flag on top of cancelled (TODO.md item 7), not a status of
  // its own, so it gets its own count and its own toggle. It reveals archived
  // heads and archived earlier runs alike, so it counts the archived runs of
  // every group that is on screen -- a live plan with an archived earlier run
  // offers the toggle even while cancelled plans are hidden.
  const archivedCount = groups
    .filter((g) => g.head.status !== "cancelled" || showCancelled)
    .reduce((n, g) => n + g.runs.filter((s) => s.archived_date).length, 0);
  const query = searchQuery.trim().toLowerCase();
  // Apply the existing cancelled/archived visibility switches first. Search
  // narrows only the groups the user has chosen to show, then sorting keeps
  // its usual order within the results.
  const available = groups
    .filter(({ head }) => {
      if (head.status !== "cancelled") return true;
      if (head.archived_date) return showCancelled && showArchived;
      return showCancelled;
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
      const headHit = matchesSearch(g.head, query);
      const hits = g.earlier.filter((s) => matchesSearch(s, query));
      hits.forEach((s) => matchedEarlier.add(s.id));
      if (hits.length && !headHit) autoOpen.add(g.key);
      return headHit || hits.length > 0;
    })
    // Sorting uses the head row; the earlier runs travel with it.
    .sort((ga, gb) => {
      const a = ga.head;
      const b = gb.head;
      const direction = sort.dir === "desc" ? -1 : 1;
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
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

  const searchBox = <SubscriptionSearch value={searchQuery} onChange={updateSearch} />;
  const listCount = query ? `${visible.length} of ${available.length}` : visible.length;
  const noResults = query && visible.length === 0 && (
    <div className="subscription-search-empty">
      <span>No subscriptions match “{searchQuery.trim()}” in this list.</span>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => updateSearch("")}>Clear search</button>
    </div>
  );

  // Entering a sort, or toggling cancelled visibility, closes any open editor:
  // the row would otherwise move out from under the cursor mid-edit.
  function sortBy(key) {
    setSort({ key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" });
    closeEditor();
    setMenuOpenId(null);
  }

  async function save(subscription) {
    // Checked here first so the common mistakes read as the design's own copy
    // rather than as Pydantic's. A server rejection is then the rare second
    // line of defence, and its message is shown verbatim with the status.
    if (!draft.name.trim()) {
      setRowError("A name is required. Nothing was saved.");
      return;
    }
    const costError = costProblem(draft.cost);
    if (costError) {
      setRowError(`Cost: ${costError} Nothing was saved.`);
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
      const status = err instanceof ApiError ? err.status : null;
      // The server's sentence, punctuated, then the code -- support triages
      // from a screenshot, so the status has to be in the copy.
      const said = err.message.replace(/[.\s]*$/, ".");
      setRowError(status ? `${said} ${status} — the change wasn't saved.` : said);
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
    const detailHints = detailIsEarlier ? EARLIER_HINTS : MENU_HINTS;
    const openDetailActions = (subscription) => (fn) => () => {
      setDetailId(null);
      fn(subscription);
    };

    const draftPerMonth =
      draft && draft.status === "active" && parseAmount(draft.cost) > 0
        ? money(perMonth({ cost: parseAmount(draft.cost), billing_cycle: draft.billing_cycle }))
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
          <h2 className="eyebrow">All subscriptions — {listCount}</h2>
        </div>

        {notice}

        {searchBox}

        {archivedCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-small mobile-list-toggle"
            onClick={() => { setShowArchived(!showArchived); closeEditor(); }}
          >
            {showArchived ? "Hide archived" : `Show archived — ${archivedCount}`}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small mobile-list-toggle"
          onClick={() => { setShowCancelled(!showCancelled); closeEditor(); }}
        >
          {showCancelled ? "Hide cancelled" : `Show cancelled — ${cancelledCount}`}
        </button>

        <div className="sort-chips" role="group" aria-label="Sort">
          {CHIPS.map((chip) => {
            const on = sort.key === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                className={on ? "sort-chip on" : "sort-chip"}
                aria-pressed={on}
                onClick={() => sortBy(chip.key)}
              >
                {chip.label}
                {on && <span>{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
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
                    <span>
                      {subscription.name} no longer exists — it was removed on another device.
                      404 on save.
                    </span>
                    <button type="button" className="btn btn-ghost btn-small" onClick={onRefreshStale}>
                      Refresh list
                    </button>
                  </span>
                </div>
              );
            }
            const cancelled = subscription.status === "cancelled";
            const archived = Boolean(subscription.archived_date);
            const status = STATUS[subscription.status];
            const earlierCount = group.earlier.length;
            const open = isOpen(group);
            return (
              <Fragment key={group.key}>
              <button
                type="button"
                className={["mobile-row", cancelled && "cancelled", earlierCount > 0 && "has-runs"]
                  .filter(Boolean).join(" ")}
                // A cancelled row has nothing to edit inline -- its sheet is
                // the read-only facts plus Manage plan. Anything else opens
                // straight into the edit sheet; a "tap to view, tap Edit to
                // edit" detour was two taps for the one thing most people
                // are here for.
                onClick={() => (cancelled ? setDetailId(subscription.id) : setEditingId(subscription.id))}
              >
                <MonoTile name={subscription.name} dim={cancelled} />
                <span className="mobile-row-main">
                  <span className="mobile-row-title">
                    <span className="mobile-row-name">{subscription.name}</span>
                    {(subscription.status !== "active" || isScheduled(subscription)) && (
                      <span className={status.tag}>{isScheduled(subscription) ? "Scheduled" : status.label}</span>
                    )}
                    {archived && <span className="tag tag-outline">Archived</span>}
                  </span>
                  <span className="mobile-row-meta">{mobileMeta(subscription)}</span>
                </span>
                <span className="mobile-row-cost">
                  <span className="mobile-row-amount">
                    {subscription.status === "trial" ? money(0) : money(subscription.cost)}
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
                  {open ? "Hide" : "Show"} {runsLabel(earlierCount)}
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
                            Run {runNumber(group, run)} of {group.runs.length}
                          </span>
                          {run.archived_date && <span className="tag tag-outline">Archived</span>}
                        </span>
                        <span className="mobile-row-meta">
                          {run.started_date ? longDate(run.started_date) : "—"}
                          {" – "}
                          {run.cancelled_date ? longDate(run.cancelled_date) : "—"}
                        </span>
                      </span>
                      <span className="mobile-row-cost">
                        <span className="mobile-row-amount">{money(run.cost)}</span>
                        <span className="mobile-row-permonth">
                          {run.paid_total == null ? run.billing_cycle : `paid ${money(run.paid_total)}`}
                        </span>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    {mobileActionError(run.id)}
                    </Fragment>
                  ))}
                  <div className="mobile-lifetime">
                    <LifetimeLine group={group} prefix="Lifetime" />
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
                <MonoTile name={detailSub.name} dim={detailSub.status === "cancelled"} />
                <p className="row-detail-name">{detailSub.name}</p>
              </div>
            }
            onClose={() => setDetailId(null)}
            className="dialog-detail"
          >
            <div className="row-detail-facts">
              {[
                ["Status", (isScheduled(detailSub) ? "Scheduled" : STATUS[detailSub.status].label) + (detailSub.archived_date ? " · Archived" : "")],
                ["Category", detailSub.category || "—"],
                [
                  "Cost",
                  `${detailSub.status === "trial" ? money(0) : money(detailSub.cost)} ${detailSub.billing_cycle}`,
                ],
                ["Per month", detailSub.status === "active" ? money(perMonth(detailSub)) : "—"],
                [
                  detailSub.status === "cancelled" ? "Access ends" : "Next renewal",
                  detailSub.status === "cancelled" && !detailSub.cancelled_date
                    ? "—"
                    : longDate(detailSub.next_renewal_date),
                ],
                ["Counts toward", detailSub.status === "active" && !isScheduled(detailSub) ? "Your totals" : "Nothing right now"],
                ...(detailSub.paid_total == null ? [] : [["Paid", money(detailSub.paid_total)]]),
                ...(detailIsEarlier ? [["Run", `${runNumber(detailGroup, detailSub)} of ${detailGroup.runs.length}`]] : []),
              ].map(([label, value]) => (
                <div className="row-detail-fact" key={label}>
                  <span className="field-label">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <div className="manage-plan">
              <span className="field-label">Manage plan</span>
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
                    <span className="manage-plan-label">{MENU_LABELS[key]}</span>
                    <span className="manage-plan-hint">{detailHints[key]}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sheet>
        )}

        {editing && draft && draft.id === editingId && (
          <Sheet title={`Edit ${editing.name}`} onClose={closeEditor} className="dialog-sheet-edit">
            <div className="sheet-fields">
              <label className="field">
                <span className="field-label">Service</span>
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
                  <span className="field-label">Cost</span>
                  <input
                    className="input tnum"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.cost}
                    onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Cycle</span>
                  <select
                    className="input"
                    value={draft.billing_cycle}
                    onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>
              <div className="sheet-row">
                <label className="field">
                  <span className="field-label">Category</span>
                  <select
                    className="input"
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  >
                    <option value="">No category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Status</span>
                  <select
                    className="input"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
              </div>
              <div className="sheet-row">
                <label className="field">
                  <span className="field-label">Started</span>
                  <input
                    className="input tnum"
                    type="date"
                    value={draft.started_date}
                    onChange={(e) => setDraft({ ...draft, started_date: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Next renewal</span>
                  <input
                    className="input tnum"
                    type="date"
                    value={draft.next_renewal_date}
                    onChange={(e) => setDraft({ ...draft, next_renewal_date: e.target.value })}
                  />
                </label>
              </div>
              <p className="sheet-hint">Per month: {draftPerMonth}</p>
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
                Save changes
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                Discard
              </button>
            </div>
            <div className="manage-plan">
              <span className="field-label">Manage plan</span>
              <div className="manage-plan-list">
                {menuKeysFor(editing).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === "delete" ? "manage-plan-item destructive" : "manage-plan-item"}
                    onClick={() => { closeEditor(); actionHandlers[key](editing); }}
                  >
                    <span className="manage-plan-label">{MENU_LABELS[key]}</span>
                    <span className="manage-plan-hint">{MENU_HINTS[key]}</span>
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
              <span>
                {subscription.name} no longer exists — it was removed on another device.
                404 on save.
              </span>
              <button type="button" className="btn btn-ghost btn-small" onClick={onRefreshStale}>
                Refresh list
              </button>
            </span>
          </td>
        </tr>
      );
    }

    if (subscription.id === editingId && draft && draft.id === editingId) {
      const draftPerMonth =
        draft.status === "active" && parseAmount(draft.cost) > 0
          ? money(perMonth({ cost: parseAmount(draft.cost), billing_cycle: draft.billing_cycle }))
          : "—";
      return (
        <Fragment key={subscription.id}>
        <tr className="row-editing">
          <td>
            <span className="row-name">
              {disclosure(group)}
              <MonoTile name={draft.name} />
              <input
                className="input"
                type="text"
                aria-label="Service"
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
              aria-label="Category"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              <option value="">No category</option>
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
              aria-label="Status"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="paused">Paused</option>
            </select>
          </td>
          <td>
            <span className="edit-cost">
              <input
                className="input tnum"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label="Cost"
                value={draft.cost}
                onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
              />
              <select
                className="input cycle-select"
                aria-label="Cycle"
                value={draft.billing_cycle}
                onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </span>
          </td>
          <td className="edit-per-month">{draftPerMonth}</td>
          <td>
            <input
              className="input tnum"
              type="date"
              aria-label="Started"
              value={draft.started_date}
              onChange={(e) => setDraft({ ...draft, started_date: e.target.value })}
            />
          </td>
          <td>
            <input
              className="input tnum"
              type="date"
              aria-label="Next renewal"
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
              Save
            </button>
            {/* "Discard", as in the mobile edit sheet -- never "Cancel", which
                would sit right next to the "Cancel plan" action. */}
            <button type="button" className="btn btn-ghost btn-small" onClick={closeEditor}>
              Discard
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
    const archived = Boolean(subscription.archived_date);
    const trial = subscription.status === "trial";
    const status = STATUS[subscription.status];
    const primary = primaryFor(subscription);
    return (
      <tr
        key={subscription.id}
        className={[cancelled && "row-cancelled", isOpen(group) && "row-group-open"].filter(Boolean).join(" ") || undefined}
      >
        <td>
          <span className="row-name">
            {disclosure(group)}
            <MonoTile name={subscription.name} dim={cancelled} />
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
          <span className={status.tag}>{isScheduled(subscription) ? "Scheduled" : status.label}</span>
          {archived && <span className="tag tag-outline">Archived</span>}
        </td>
        <td className="tnum">
          <span>{trial ? money(0) : money(subscription.cost)}</span>
          <span className="sub-note">
            {trial
              ? `then ${money(subscription.cost)}${cycleSuffix(subscription.billing_cycle)}`
              : subscription.billing_cycle}
          </span>
        </td>
        <td className="tnum">
          {subscription.status === "active" ? money(perMonth(subscription)) : "—"}
        </td>
        <td className="tnum">
          {/* Blank for rows imported from a backup written before the
              column existed -- an em dash says "not recorded", which
              is what the spend summary reads it as. */}
          {subscription.started_date ? longDate(subscription.started_date) : "—"}
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
              ? "trial ends"
              : subscription.status === "paused"
                ? "resumes when unpaused"
                : cancelled
                  ? subscription.cancelled_date
                    ? "access ends"
                    : ""
                  : ""}
          </span>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={`${primary.label} ${subscription.name}`}
            onClick={
              primary.key
                ? () => actionHandlers[primary.key](subscription)
                : () => setEditingId(subscription.id)
            }
          >
            {primary.label}
          </button>
          {moreMenu(subscription, menuKeysFor(subscription), MENU_HINTS, `More actions for ${subscription.name}`)}
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
        aria-label={`${open ? "Hide" : "Show"} ${runsLabel(n)} of ${group.head.name}`}
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
          More ▾
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
                <span className="row-menu-label">{MENU_LABELS[key]}</span>
                <span className="row-menu-hint">{hints[key]}</span>
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
                  <span>Earlier run</span>
                  <span className="sub-note">Run {runNumber(group, run)} of {group.runs.length}</span>
                </span>
              </span>
            </td>
            <td />
            <td>
              <span className={STATUS[run.status].tag}>{STATUS[run.status].label}</span>
              {run.archived_date && <span className="tag tag-outline">Archived</span>}
            </td>
            <td className="tnum">
              <span>{money(run.cost)}</span>
              <span className="sub-note">{run.billing_cycle}</span>
            </td>
            <td className="tnum">—</td>
            <td className="tnum">{run.started_date ? longDate(run.started_date) : "—"}</td>
            <td className="tnum">
              <span>{run.cancelled_date ? longDate(run.cancelled_date) : "—"}</span>
              <span className="sub-note">
                {run.paid_total == null ? "cancelled" : `cancelled · paid ${money(run.paid_total)}`}
              </span>
            </td>
            <td className="row-actions">
              {moreMenu(
                run,
                earlierMenuKeys(run),
                EARLIER_HINTS,
                `More actions for run ${runNumber(group, run)} of ${group.head.name}`,
              )}
            </td>
          </tr>
          {actionErrorRow(run.id)}
          </Fragment>
        ))}
        <tr className="row-lifetime">
          <td colSpan={8}>
            <LifetimeLine group={group} prefix={`Lifetime with ${group.head.name}`} />
          </td>
        </tr>
      </>
    );
  }

  return (
    <section id="all" className="table-section">
      <div className="section-head">
        <h2 className="eyebrow">All subscriptions — {listCount}</h2>
        <span className="table-actions">
          {searchBox}
          {archivedCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => { setShowArchived(!showArchived); closeEditor(); }}
            >
              {showArchived ? "Hide archived" : `Show archived — ${archivedCount}`}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => { setShowCancelled(!showCancelled); closeEditor(); }}
          >
            {showCancelled ? "Hide cancelled" : `Show cancelled — ${cancelledCount}`}
          </button>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            Add subscription
          </button>
        </span>
      </div>

      {notice}

      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const on = sort.key === column.key;
              const asc = sort.dir === "asc";
              return (
                <th key={column.key} scope="col" aria-sort={on ? (asc ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={on ? "sort-button on" : "sort-button"}
                    onClick={() => sortBy(column.key)}
                    title={
                      on && asc
                        ? "Sorted A–Z — click to reverse"
                        : on
                          ? "Sorted Z–A — click to reverse"
                          : `Sort by ${column.label.toLowerCase()}`
                    }
                  >
                    <span>{column.label}</span>
                    <span className="sort-arrow">{on ? (asc ? "↑" : "↓") : "↕"}</span>
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
