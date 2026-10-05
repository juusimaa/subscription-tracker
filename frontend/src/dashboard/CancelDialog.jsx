// Cancelling here records a cancel; it does not reach the provider. The
// dialog says so first, because "Cancel" alone reads as acting on the real
// service, and someone who believed that would keep paying.
//
// The date stamps "today" by default, but it is editable so a plan cancelled
// last month can be recorded as such -- otherwise its charges between the
// real cancel date and today would count toward totals that already stopped
// happening. When access runs out follows from that date, so it is worked out
// as the date changes and shown before the user commits, not only in the
// notice afterwards.
//
// Deleting is not offered here. It is a different decision with no undo, and
// it lives in the row's own menu.

import { useState } from "react";
import { describeWriteError } from "../api";
import { longDate, todayISO } from "../format";
import { TriangleAlert } from "../icons";
import { accessEndsAfter } from "../renewals";
import { useModal } from "../useModal";

function CancelDialog({ subscription, onConfirm, onClose }) {
  const today = todayISO();
  const isTrial = subscription.status === "trial";
  const notStarted = subscription.started_date && subscription.started_date > today;
  // A paused plan stopped costing money the day it was paused, so that is
  // the cancel date the server would pick too (crud._apply_status_dates).
  const [cancelledDate, setCancelledDate] = useState(subscription.paused_date || today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useModal(busy ? undefined : onClose);
  // The server stamps no date on a trial that stops before converting -- it
  // never charged -- so the field would be asking for something unused.
  const asksForDate = !notStarted && !isTrial;

  // The dialog closes itself only by going away: the parent unmounts it once
  // the write has landed. A failure keeps it open with the reason, and the
  // date the user picked still in the field.
  async function confirm() {
    if (asksForDate && !cancelledDate) {
      setError("Choose the date you cancelled it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(asksForDate ? { cancelled_date: cancelledDate } : {});
    } catch (err) {
      setError(describeWriteError(err));
      setBusy(false);
    }
  }

  const title = notStarted
    ? `Mark ${subscription.name}'s new run as cancelled?`
    : isTrial
    ? `Mark the ${subscription.name} trial as cancelled?`
    : `Mark ${subscription.name} as cancelled?`;

  // The provider is the one who charges. Said once, before anything else,
  // with the date that is at stake when there is one.
  const provider = isTrial
    ? `This updates your records only. To avoid the charge on ${longDate(subscription.next_renewal_date)}, cancel the trial with ${subscription.name} too.`
    : `This updates your records only. Cancel with ${subscription.name} too, or they will keep charging.`;

  const anchor = subscription.started_date || subscription.next_renewal_date;
  const accessEnds =
    asksForDate && cancelledDate && anchor
      ? accessEndsAfter(anchor, subscription.billing_cycle, cancelledDate)
      : null;

  let outcome;
  if (notStarted) {
    outcome = "It has not charged yet. The earlier paid run stays in your history.";
  } else if (isTrial) {
    outcome = "It moves to your ended plans without a charge on record. You can reactivate it any time.";
  } else if (accessEnds && accessEnds > today) {
    outcome = `Access runs until ${longDate(accessEnds)}, the end of the time already paid for. It stays in the list until then and stops counting toward your totals.`;
  } else if (accessEnds) {
    outcome = `Access ended ${longDate(accessEnds)}. It moves to your ended plans, where its past charges stay on record.`;
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
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{title}</p>
        <p className="dialog-body">{provider}</p>
        {asksForDate && (
          <label className="field cancel-date">
            <span className="field-label">Cancelled on</span>
            <input
              className="input tnum"
              type="date"
              value={cancelledDate}
              min={subscription.started_date || undefined}
              onChange={(e) => setCancelledDate(e.target.value)}
            />
          </label>
        )}
        {outcome && (
          <p className="dialog-body tnum" aria-live="polite">
            {outcome}
          </p>
        )}
        {error && (
          <p role="alert" className="dialog-error">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            Mark as cancelled
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}

export default CancelDialog;
