// The last thing between a file and the account. Nothing is written until
// the button in here is pressed, and every number on it comes from the real
// diff (see backup.js) rather than from the file's own row count -- a summary
// that estimates is worse than none, because it is believed.

import { TriangleAlert } from "../icons";

// Enough names to recognise the file, then a count. The full list of fourteen
// tells the user nothing the number above it did not.
function names(list) {
  if (list.length <= 5) return list.join(", ");
  return `${list.slice(0, 5).join(", ")} and ${list.length - 5} more`;
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
  const plural = diff.subscriptions === 1 ? "" : "s";

  return (
    <div className="dialog-backdrop confirm" onClick={busy ? undefined : onCancel}>
      <div
        className="dialog dialog-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title" id="import-title">Import {filename}?</p>
        <p className="dialog-body">
          {diff.subscriptions} subscription{plural} and {diff.categories} categor
          {diff.categories === 1 ? "y" : "ies"}{" "}
          {replace
            ? "read. Your current list will be cleared and replaced by this file."
            : "read, checked against your list. Nothing is written until you confirm."}
        </p>

        <div className="ledger">
          {replace ? (
            <>
              <Row kind="Import" detail="Subscriptions in the file" count={diff.subscriptions} />
              <Row kind="Import" detail="Categories in the file" count={diff.categories} />
              <Row
                kind="Remove"
                detail="Subscriptions you have now, cancelled ones included"
                count={diff.removed}
              />
            </>
          ) : (
            <>
              <Row
                kind="Add"
                detail={diff.added.length ? `New to your list — ${names(diff.added)}` : "Nothing new in this file"}
                count={diff.added.length}
              />
              <Row
                kind="Update"
                detail={
                  diff.updated.length
                    ? `Same name, different cost or renewal date — ${names(diff.updated)}`
                    : "Nothing to change"
                }
                count={diff.updated.length}
              />
              <Row kind="Unchanged" detail="Already identical, left alone" count={diff.unchanged} />
              {diff.newCategories.length > 0 && (
                <Row
                  kind="New category"
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
            <p>
              Replace all wipes the {diff.removed} subscription{diff.removed === 1 ? "" : "s"} you
              have now, including cancelled ones. Export first if you might want them back.
            </p>
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
              ? "Importing…"
              : `${replace ? "Replace with" : "Merge"} ${diff.subscriptions} subscription${plural}`}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small another"
            disabled={busy}
            onClick={onAnotherFile}
          >
            Choose another file
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportSummary;
