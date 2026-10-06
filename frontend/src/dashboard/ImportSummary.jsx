// The last thing between a file and the account. Nothing is written until
// the button in here is pressed, and every number on it comes from the real
// diff (see backup.js) rather than from the file's own row count -- a summary
// that estimates is worse than none, because it is believed.

import { TriangleAlert } from "../icons";
import { t } from "../i18n";
import { useModal } from "../useModal";

// Enough names to recognise the file, then a count. The full list of fourteen
// tells the user nothing the number above it did not.
function names(list) {
  if (list.length <= 5) return list.join(", ");
  return t("importSummary.more", { list: list.slice(0, 5).join(", "), n: list.length - 5 });
}

function Row({ kind, detail, count }) {
  return (
    <div className="ledger-row">
      <span className="kind">{kind}</span>
      <span className="detail">{detail}</span>
      <span className="count tnum">{count}</span>
    </div>
  );
}

function ImportSummary({ filename, diff, busy, error, onConfirm, onCancel, onAnotherFile }) {
  const replace = diff.mode === "replace";
  // Like the backdrop, Escape does nothing while the import is being written.
  const ref = useModal(busy ? undefined : onCancel);

  return (
    <div className="dialog-backdrop confirm" onClick={busy ? undefined : onCancel}>
      <div
        ref={ref}
        className="dialog dialog-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-busy={busy || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title" id="import-title">{t("importSummary.title", { filename })}</p>
        <p className="dialog-body">
          {t(replace ? "importSummary.body.replace" : "importSummary.body.merge", {
            subscriptions: diff.subscriptions,
            categories: diff.categories,
          })}
        </p>

        <div className="ledger">
          {replace ? (
            <>
              <Row
                kind={t("importSummary.kind.import")}
                detail={t("importSummary.fileSubscriptions")}
                count={diff.subscriptions}
              />
              <Row
                kind={t("importSummary.kind.import")}
                detail={t("importSummary.fileCategories")}
                count={diff.categories}
              />
              <Row
                kind={t("importSummary.kind.remove")}
                detail={t("importSummary.currentSubscriptions")}
                count={diff.removed}
              />
            </>
          ) : (
            <>
              <Row
                kind={t("importSummary.kind.add")}
                detail={
                  diff.added.length
                    ? t("importSummary.added", { names: names(diff.added) })
                    : t("importSummary.nothingNew")
                }
                count={diff.added.length}
              />
              <Row
                kind={t("importSummary.kind.update")}
                detail={
                  diff.updated.length
                    ? t("importSummary.updated", { names: names(diff.updated) })
                    : t("importSummary.nothingToChange")
                }
                count={diff.updated.length}
              />
              <Row
                kind={t("importSummary.kind.unchanged")}
                detail={t("importSummary.unchanged")}
                count={diff.unchanged}
              />
              {diff.newCategories.length > 0 && (
                <Row
                  kind={t("importSummary.kind.newCategory")}
                  detail={names(diff.newCategories)}
                  count={diff.newCategories.length}
                />
              )}
            </>
          )}
        </div>

        {/* Replace is the only mode that deletes, so it is the only one that
            warns -- and it names the number, because "everything" is easy to
            agree to and "12 subscriptions" is not. */}
        {replace && (
          <div className="import-warning">
            <TriangleAlert size={16} color="var(--color-accent-900)" />
            <p>{t("importSummary.warning", { n: diff.removed })}</p>
          </div>
        )}

        {/* A failure from the write itself, not from reading the file: the
            dialog stays open so the user can retry or back out, rather than
            closing over an account in an unknown state. */}
        {error && (
          <div role="alert" className="dialog-error">
            <TriangleAlert size={16} color="var(--color-accent-900)" />
            <p>{error}</p>
          </div>
        )}

        <div className="dialog-actions">
          {/* The label states the outcome. "Confirm" would be the same button
              for both modes, and one of them deletes everything. */}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy
              ? t("importSummary.importing")
              : t(replace ? "importSummary.confirm.replace" : "importSummary.confirm.merge", {
                  n: diff.subscriptions,
                })}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            {t("importSummary.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small another"
            disabled={busy}
            onClick={onAnotherFile}
          >
            {t("importSummary.anotherFile")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportSummary;
