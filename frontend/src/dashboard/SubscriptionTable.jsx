// The full list: sortable, inline-editable, statuses and all.
//
// Sorting is client-side, which costs nothing here -- GET /subscriptions
// returns the whole unpaginated list, and it already arrives in the design's
// default order (next renewal, then name). Ties always break on name so a
// column of equal values does not reshuffle itself between renders.
//
// Editing happens in the row. A modal would hide the neighbouring rows, which
// are the context for whether a number looks right.

import { Fragment, useState } from "react";
import { ApiError } from "../api";
import MonoTile from "../MonoTile";
import Sheet from "./Sheet";
import { ChevronRight, TriangleAlert } from "../icons";
import { longDate, money, perMonth } from "../format";
import { useIsMobile } from "../useMediaQuery";

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
// sub-note): "Entertainment · 04 Sep 2026", "Work · last charge 30 Jul 2026".
function mobileMeta(subscription) {
  const cancelled = subscription.status === "cancelled";
  const trial = subscription.status === "trial";
  const paused = subscription.status === "paused";
  let dateText;
  if (cancelled && !subscription.cancelled_date) dateText = "—";
  else if (cancelled) dateText = `last charge ${longDate(subscription.next_renewal_date)}`;
  else if (paused) dateText = "resumes when unpaused";
  else if (trial) dateText = `trial ends ${longDate(subscription.next_renewal_date)}`;
  else dateText = longDate(subscription.next_renewal_date);
  return subscription.category ? `${subscription.category} · ${dateText}` : dateText;
}

function mobilePerMonthNote(subscription) {
  if (subscription.status === "trial") {
    return `then ${money(subscription.cost)}${subscription.billing_cycle === "yearly" ? "/yr" : "/mo"}`;
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
    case "cost": return Number(subscription.cost);
    // Non-charging rows sort together at one end rather than being scattered
    // through the numbers by a cost they are not paying.
    case "perMonth": return subscription.status === "active" ? perMonth(subscription) : -1;
    // Rows restored from a backup taken before this column existed have no
    // start date; "" groups those together at one end rather than scattering
    // them, the same idea as the -1 above.
    case "started": return subscription.started_date || "";
    case "renewal": return subscription.next_renewal_date;
    default: return subscription.name.toLowerCase();
  }
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
  onRestore,
  onArchive,
  onUnarchive,
  onDeleteArchived,
  onAdd,
  staleId,
  onRefreshStale,
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
  const isMobile = useIsMobile();

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

  // Archived is a flag on top of cancelled (TODO.md item 7), not a status of
  // its own, so it gets its own count and its own toggle -- one that only
  // matters, and only appears, once cancelled rows are visible at all.
  const cancelledCount = subscriptions.filter(
    (s) => s.status === "cancelled" && !s.archived_date,
  ).length;
  const archivedCount = subscriptions.filter((s) => s.archived_date).length;
  const visible = subscriptions
    .filter((s) => {
      if (s.status !== "cancelled") return true;
      if (s.archived_date) return showCancelled && showArchived;
      return showCancelled;
    })
    .slice()
    .sort((a, b) => {
      const direction = sort.dir === "desc" ? -1 : 1;
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va < vb) return -direction;
      if (va > vb) return direction;
      return a.name.localeCompare(b.name);
    });

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
    setRowError(null);
  }

  // Entering a sort, or toggling cancelled visibility, closes any open editor:
  // the row would otherwise move out from under the cursor mid-edit.
  function sortBy(key) {
    setSort({ key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" });
    closeEditor();
  }

  async function save(subscription) {
    // Checked here first so the common mistakes read as the design's own copy
    // rather than as Pydantic's. A server rejection is then the rare second
    // line of defence, and its message is shown verbatim with the status.
    if (!draft.name.trim()) {
      setRowError("A name is required. Nothing was saved.");
      return;
    }
    if (!(Number(draft.cost) > 0)) {
      setRowError("Cost must be greater than 0. Nothing was saved.");
      return;
    }
    setBusy(true);
    try {
      await onSave(subscription.id, {
        name: draft.name.trim(),
        category: draft.category || null,
        status: draft.status,
        cost: Number(draft.cost),
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
    const openDetailActions = (subscription) => (fn) => () => {
      setDetailId(null);
      fn(subscription);
    };

    const draftPerMonth =
      draft && draft.status === "active" && Number(draft.cost) > 0
        ? money(perMonth({ cost: draft.cost, billing_cycle: draft.billing_cycle }))
        : "—";

    return (
      <section id="all" className="table-section">
        <div className="section-head">
          <span className="eyebrow">All subscriptions — {visible.length}</span>
        </div>

        {archivedCount > 0 && showCancelled && (
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
          {visible.map((subscription) => {
            if (subscription.id === staleId) {
              return (
                <div key={subscription.id} className="mobile-row-stale">
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
            return (
              <button
                key={subscription.id}
                type="button"
                className={cancelled ? "mobile-row cancelled" : "mobile-row"}
                onClick={() => setDetailId(subscription.id)}
              >
                <MonoTile name={subscription.name} dim={cancelled} />
                <span className="mobile-row-main">
                  <span className="mobile-row-title">
                    <span className="mobile-row-name">{subscription.name}</span>
                    {subscription.status !== "active" && (
                      <span className={status.tag}>{status.label}</span>
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
                ["Status", STATUS[detailSub.status].label + (detailSub.archived_date ? " · Archived" : "")],
                ["Category", detailSub.category || "—"],
                [
                  "Cost",
                  `${detailSub.status === "trial" ? money(0) : money(detailSub.cost)} ${detailSub.billing_cycle}`,
                ],
                ["Per month", detailSub.status === "active" ? money(perMonth(detailSub)) : "—"],
                [
                  detailSub.status === "cancelled" ? "Last charge" : "Next renewal",
                  detailSub.status === "cancelled" && !detailSub.cancelled_date
                    ? "—"
                    : longDate(detailSub.next_renewal_date),
                ],
                ["Counts toward", detailSub.status === "active" ? "Your totals" : "Nothing right now"],
              ].map(([label, value]) => (
                <div className="row-detail-fact" key={label}>
                  <span className="field-label">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            <div className="row-detail-actions">
              {detailSub.status === "cancelled" ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openDetailActions(detailSub)(onReactivate)}
                  >
                    Reactivate
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openDetailActions(detailSub)(onRestore)}
                  >
                    Restore
                  </button>
                  {detailSub.archived_date ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={openDetailActions(detailSub)(onUnarchive)}
                      >
                        Restore to list
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={openDetailActions(detailSub)(onDeleteArchived)}
                      >
                        Delete permanently
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={openDetailActions(detailSub)(onArchive)}
                    >
                      Archive
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => { setDetailId(null); setEditingId(detailSub.id); }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openDetailActions(detailSub)(onCancelPlan)}
                  >
                    Cancel plan
                  </button>
                </>
              )}
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
              <label className="field">
                <span className="field-label">Next renewal</span>
                <input
                  className="input tnum"
                  type="date"
                  value={draft.next_renewal_date}
                  onChange={(e) => setDraft({ ...draft, next_renewal_date: e.target.value })}
                />
              </label>
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
          </Sheet>
        )}
      </section>
    );
  }

  return (
    <section id="all" className="table-section">
      <div className="section-head">
        <span className="eyebrow">All subscriptions — {visible.length}</span>
        <span className="table-actions">
          {showCancelled && archivedCount > 0 && (
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
          {visible.map((subscription) => {
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
                draft.status === "active" && Number(draft.cost) > 0
                  ? money(perMonth({ cost: draft.cost, billing_cycle: draft.billing_cycle }))
                  : "—";
              return (
                <Fragment key={subscription.id}>
                <tr className="row-editing">
                  <td>
                    <span className="row-name">
                      <MonoTile name={draft.name} />
                      <input
                        className="input"
                        type="text"
                        aria-label="Service"
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
                    <button type="button" className="btn btn-ghost btn-small" onClick={closeEditor}>
                      Cancel
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
            return (
              <tr key={subscription.id} className={cancelled ? "row-cancelled" : undefined}>
                <td>
                  <span className="row-name">
                    <MonoTile name={subscription.name} dim={cancelled} />
                    {subscription.name}
                  </span>
                </td>
                <td>{subscription.category}</td>
                <td>
                  {/* Archived is a flag on top of cancelled, not a status of
                      its own (TODO.md item 7), so it rides along as a second
                      tag rather than replacing "Cancelled". */}
                  <span className={status.tag}>{status.label}</span>
                  {archived && <span className="tag tag-outline">Archived</span>}
                </td>
                <td className="tnum">
                  <span>{trial ? money(0) : money(subscription.cost)}</span>
                  <span className="sub-note">
                    {trial
                      ? `then ${money(subscription.cost)}${subscription.billing_cycle === "yearly" ? "/yr" : "/mo"}`
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
                  {cancelled ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => onReactivate(subscription)}
                      >
                        Reactivate
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => onRestore(subscription)}>
                        Restore
                      </button>
                      {archived ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onUnarchive(subscription)}
                          >
                            Restore to list
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onDeleteArchived(subscription)}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost" onClick={() => onArchive(subscription)}>
                          Archive
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditingId(subscription.id)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => onCancelPlan(subscription)}>
                        Cancel plan
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default SubscriptionTable;
