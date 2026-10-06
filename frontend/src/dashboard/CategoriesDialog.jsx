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
import { describeWriteError } from "../api";
import { TriangleAlert } from "../icons";
import { cycleSuffix, money, perMonth } from "../format";
import { t } from "../i18n";
import { useModal } from "../useModal";

// schemas.CategoryBase: the server refuses anything longer.
const CATEGORY_MAX = 50;

// Its own component so it gets its own place on the modal stack: Escape here
// closes this confirm and leaves the categories dialog open underneath.
function ConfirmCategoryDelete({ category, onConfirm, onClose }) {
  const ref = useModal(onClose);
  return (
    <div className="dialog-backdrop confirm" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        ref={ref}
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={t("categories.deleteTitle", { name: category.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{t("categories.deleteTitle", { name: category.name })}</p>
        <p className="dialog-body">{t("categories.deleteBody")}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {t("categories.delete")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("categories.keep")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoriesDialog({ categories, subscriptions, onCreate, onRename, onDelete, onClose }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // One write at a time: a second tap on "Add category" while the first is
  // still in flight would create the category twice.
  const [busy, setBusy] = useState(false);
  const ref = useModal(onClose);

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
          ? cancelled > 0 ? t("categories.onlyCancelled") : t("categories.unused")
          : t("categories.count", { n: live.length }),
      monthly: charging.length === 0
        ? "—"
        : `${money(charging.reduce((sum, s) => sum + perMonth(s), 0))}${cycleSuffix("monthly")}`,
    };
  }

  async function run(action) {
    if (busy) return false;
    setError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeWriteError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The names are checked here first so the common mistakes read as this
  // dialog's own copy. Case-insensitive, like usageOf above: "work" next to
  // "Work" would split one category's subscriptions across two bars.
  function nameProblem(name, exceptId) {
    if (!name) return t("categories.nameRequired");
    const clash = categories.find(
      (c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(),
    );
    return clash ? t("categories.nameTaken", { name: clash.name }) : null;
  }

  async function saveRename(category) {
    const name = renameValue.trim();
    if (name === category.name) { setRenamingId(null); return; }
    const problem = nameProblem(name, category.id);
    if (problem) { setError(problem); return; }
    if (await run(() => onRename(category.id, name))) setRenamingId(null);
  }

  async function addCategory() {
    const name = newName.trim();
    const problem = nameProblem(name, null);
    if (problem) { setError(problem); return; }
    if (await run(() => onCreate(name))) setNewName("");
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="categories-title"
        aria-busy={busy || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <p className="dialog-title" id="categories-title">{t("categories.title", { n: categories.length })}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label={t("categories.close")}>
            {t("categories.close")}
          </button>
        </div>

        <div>
          {categories.map((category) => {
            const usage = usageOf(category);
            if (renamingId === category.id) {
              return (
                <form
                  className="cat-row-renaming"
                  key={category.id}
                  onSubmit={(event) => { event.preventDefault(); saveRename(category); }}
                >
                  <input
                    className="input"
                    type="text"
                    aria-label={t("categories.newNameFor", { name: category.name })}
                    maxLength={CATEGORY_MAX}
                    autoComplete="off"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    // Escape backs out of the rename, not out of the whole
                    // dialog -- the field is the thing being cancelled.
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    // Mounted mid-dialog, so useModal's open-time focus has
                    // already happened; the field takes focus itself.
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {t("categories.save")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setRenamingId(null)}
                  >
                    {t("categories.cancelRename")}
                  </button>
                </form>
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
                    aria-label={t("categories.renameLabel", { name: category.name })}
                    onClick={() => { setRenamingId(category.id); setRenameValue(category.name); setError(null); }}
                  >
                    {t("categories.rename")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={usage.live > 0 || busy}
                    aria-label={t("categories.deleteLabel", { name: category.name })}
                    title={
                      usage.live > 0
                        ? t("categories.stillUsed", { n: usage.live })
                        : undefined
                    }
                    onClick={() => setConfirmDelete(category)}
                  >
                    {t("categories.delete")}
                  </button>
                </span>
              </div>
            );
          })}

          <form
            className="cat-new"
            onSubmit={(event) => { event.preventDefault(); addCategory(); }}
          >
            <label className="field">
              <span className="field-label">{t("categories.newCategory")}</span>
              <input
                className="input"
                type="text"
                placeholder={t("categories.placeholder")}
                maxLength={CATEGORY_MAX}
                autoComplete="off"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              {t("categories.add")}
            </button>
          </form>

          {error && (
            <p role="alert" className="dialog-error">
              <TriangleAlert />
              <span>{error}</span>
            </p>
          )}

          <p className="cat-rule">{t("categories.rule")}</p>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmCategoryDelete
          category={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const category = confirmDelete;
            setConfirmDelete(null);
            await run(() => onDelete(category.id));
          }}
        />
      )}
    </div>
  );
}

export default CategoriesDialog;
