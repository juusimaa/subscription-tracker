// The category manager, opened from "Manage" beside the category bars.
//
// Two of the three columns are computed here rather than read from the API.
// GET /categories returns one all-inclusive `subscription_count`, which cannot
// tell "only cancelled plans" from "unused" and has no monthly total in it
// (TODO.md D6), so both come from the subscription list the page already has.
// Deletion follows the design's rule -- only a *live* subscription blocks it,
// a cancelled one keeps its category on record without holding it hostage.
//
// The server counts cancelled rows too, so deleting a category used only by
// cancelled plans comes back as a 409. That is a real disagreement rather than
// a bug on either side; the message is shown in the dialog rather than
// swallowed, because the alternative -- retrying with detach=true -- would
// strip the label off those cancelled rows, which is the one thing the design
// says must not happen.

import { useState } from "react";
import { ApiError } from "../api";
import { TriangleAlert } from "../icons";
import { money, perMonth } from "../format";

function CategoriesDialog({ categories, subscriptions, onCreate, onRename, onDelete, onClose }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  function usageOf(category) {
    const inCategory = subscriptions.filter(
      (s) => (s.category || "").toLowerCase() === category.name.toLowerCase(),
    );
    const live = inCategory.filter((s) => s.status !== "cancelled");
    const cancelled = inCategory.length - live.length;
    const charging = live.filter((s) => s.status === "active");
    return {
      live: live.length,
      // "Live" spans four statuses now, not a boolean: a trial occupies a
      // category without paying for it, and a paused plan is coming back.
      // Both hold the category; neither contributes to the monthly figure.
      label:
        live.length === 0
          ? cancelled > 0 ? "Only cancelled plans" : "Unused"
          : `${live.length} subscription${live.length === 1 ? "" : "s"}`,
      monthly: charging.length === 0
        ? "—"
        : `${money(charging.reduce((sum, s) => sum + perMonth(s), 0))}/mo`,
    };
  }

  async function run(action) {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.status})` : err.message);
      return false;
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="categories-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <p className="dialog-title" id="categories-title">Categories — {categories.length}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div>
          {categories.map((category) => {
            const usage = usageOf(category);
            if (renamingId === category.id) {
              return (
                <div className="cat-row-renaming" key={category.id}>
                  <input
                    className="input"
                    type="text"
                    aria-label="Category name"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      if (await run(() => onRename(category.id, renameValue.trim()))) {
                        setRenamingId(null);
                      }
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              );
            }
            return (
              <div className="cat-row" key={category.id}>
                <span className="name">{category.name}</span>
                <span className="usage">{usage.label}</span>
                <span className="monthly">{usage.monthly}</span>
                <span className="actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => { setRenamingId(category.id); setRenameValue(category.name); }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={usage.live > 0}
                    title={
                      usage.live > 0
                        ? `${usage.live} subscription${usage.live === 1 ? "" : "s"} still use${usage.live === 1 ? "s" : ""} this category`
                        : undefined
                    }
                    onClick={() => setConfirmDelete(category)}
                  >
                    Delete
                  </button>
                </span>
              </div>
            );
          })}

          <div className="cat-new">
            <label className="field">
              <span className="field-label">New category</span>
              <input
                className="input"
                type="text"
                placeholder="Transport, Education, …"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (!newName.trim()) return;
                if (await run(() => onCreate(newName.trim()))) setNewName("");
              }}
            >
              Add category
            </button>
          </div>

          {error && (
            <p role="alert" className="dialog-error">
              <TriangleAlert />
              <span>{error}</span>
            </p>
          )}

          <p className="cat-rule">
            A category can only be deleted once no live subscription uses it — move or cancel its
            subscriptions first. Cancelled plans keep their category on record but don&apos;t block
            deletion. Renaming applies everywhere it appears.
          </p>
        </div>
      </div>

      {confirmDelete && (
        <div className="dialog-backdrop confirm" onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}>
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="dialog-title">Delete the {confirmDelete.name} category?</p>
            <p className="dialog-body">
              Nothing uses it, so no subscription changes. You can add it again later.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const category = confirmDelete;
                  setConfirmDelete(null);
                  await run(() => onDelete(category.id));
                }}
              >
                Delete
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CategoriesDialog;
