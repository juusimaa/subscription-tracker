// The two confirm dialogs. Both are the same shape -- title, one paragraph
// that says what actually happens, then the actions -- so they are one
// component with the destructive third button as an option.
//
// The dialog stays open until the write has gone through. Closing first and
// writing after would leave a failure nowhere to be said: the row would just
// still be there, with nothing explaining why.

import { useState } from "react";
import { describeWriteError } from "../api";
import { TriangleAlert } from "../icons";
import { t } from "../i18n";
import { useModal } from "../useModal";

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, destructive }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useModal(busy ? undefined : onClose);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(describeWriteError(err));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop confirm" onClick={busy ? undefined : onClose}>
      <div
        ref={ref}
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        // Clicks inside must not reach the backdrop, which closes.
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{title}</p>
        <p className="dialog-body">{body}</p>
        {error && (
          <p role="alert" className="dialog-error">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(onConfirm)}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            {t("confirm.keep")}
          </button>
          {/* Destruction is opt-in and deliberately de-emphasised: the default
              is archive, which keeps the past charges on record. */}
          {destructive && (
            <button
              type="button"
              className="btn btn-ghost destructive"
              disabled={busy}
              onClick={() => run(destructive.onClick)}
            >
              {destructive.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
