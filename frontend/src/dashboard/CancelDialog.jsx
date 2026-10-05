// Cancelling stamps "today" by default, but the
// date is editable so a plan cancelled last month can be recorded as such --
// otherwise its charges between the real cancel date and today would count
// toward totals that already stopped happening.

import { useState } from "react";
import { describeWriteError } from "../api";
import { todayISO } from "../format";
import { TriangleAlert } from "../icons";
import { useModal } from "../useModal";

function CancelDialog({ subscription, onConfirm, onClose, destructive }) {
  const [cancelledDate, setCancelledDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useModal(busy ? undefined : onClose);
  const notStarted = subscription.started_date && subscription.started_date > todayISO();

  // The dialog closes itself only by going away: the parent unmounts it once
  // the write has landed. A failure keeps it open with the reason, and the
  // date the user picked still in the field.
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

  function confirm() {
    if (!notStarted && !cancelledDate) {
      setError("Choose the date it was cancelled.");
      return;
    }
    run(() => onConfirm(notStarted ? {} : { cancelled_date: cancelledDate }));
  }

  // A trial that cancels here never gets to its first charge -- worth saying
  // plainly in the title, since "Cancel?" alone reads as ambiguous right at
  // the moment that distinction is the whole point.
  const title =
    notStarted
      ? `Cancel ${subscription.name} before it starts?`
      : subscription.status === "trial"
      ? `Cancel ${subscription.name} before it charges?`
      : `Cancel ${subscription.name}?`;

  return (
    <div className="dialog-backdrop confirm" onClick={busy ? undefined : onClose}>
      <div
        ref={ref}
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{title}</p>
        <p className="dialog-body">
          {notStarted
            ? "The new run has not charged yet. Cancelling it keeps the earlier paid run in your history."
            : "It stops counting toward your totals but stays in the list until the time already paid for runs out. After that it moves to your ended plans, where its past charges stay on record. You can reactivate it any time."}
        </p>
        {!notStarted && <label className="field">
          <span className="field-label">Cancelled date</span>
          <input
            className="input tnum"
            type="date"
            value={cancelledDate}
            min={subscription.started_date || undefined}
            onChange={(e) => setCancelledDate(e.target.value)}
          />
        </label>}
        {error && (
          <p role="alert" className="dialog-error">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            Cancel plan
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Keep it
          </button>
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

export default CancelDialog;
