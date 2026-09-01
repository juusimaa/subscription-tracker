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
import { TriangleAlert } from "../icons";
import { longDate, money, perMonth } from "../format";

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
  editingId,
  setEditingId,
  onSave,
  onCancelPlan,
  onRestore,
  onAdd,
  staleId,
  onRefreshStale,
}) {
  // The draft carries the id it belongs to, so a stale one can never be
  // rendered into a different row than the one it was opened from.
  const [draft, setDraft] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [busy, setBusy] = useState(false);

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
      next_renewal_date: editing.next_renewal_date,
    });
    setRowError(null);
  }

  const cancelledCount = subscriptions.filter((s) => s.status === "cancelled").length;
  const visible = subscriptions
    .filter((s) => showCancelled || s.status !== "cancelled")
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

  return (
    <section id="all" className="table-section">
      <div className="section-head">
        <span className="eyebrow">All subscriptions — {visible.length}</span>
        <span className="table-actions">
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
                  <td colSpan={7}>
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
                    <td colSpan={7}>
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
                <td><span className={status.tag}>{status.label}</span></td>
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
                  <span>{longDate(subscription.next_renewal_date)}</span>
                  <span className="sub-note">
                    {trial
                      ? "trial ends"
                      : subscription.status === "paused"
                        ? "resumes when unpaused"
                        : cancelled
                          ? "last charge"
                          : ""}
                  </span>
                </td>
                <td className="row-actions">
                  {cancelled ? (
                    <button type="button" className="btn btn-ghost" onClick={() => onRestore(subscription)}>
                      Restore
                    </button>
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
