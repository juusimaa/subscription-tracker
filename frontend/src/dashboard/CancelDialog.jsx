// Same shape as RestoreDialog: cancelling stamps "today" by default, but the
// date is editable so a plan cancelled last month can be recorded as such --
// otherwise its charges between the real cancel date and today would count
// toward totals that already stopped happening.

import { useState } from "react";
import { todayISO } from "../format";

function CancelDialog({ subscription, onConfirm, onClose, destructive }) {
  const [cancelledDate, setCancelledDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm({ cancelled_date: cancelledDate });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop confirm" onClick={onClose}>
      <div
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={`Cancel ${subscription.name}?`}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">Cancel {subscription.name}?</p>
        <p className="dialog-body">
          It stops counting toward your totals and moves to your cancelled list, where its past
          charges stay on record. You can restore it any time.
        </p>
        <label className="field">
          <span className="field-label">Cancelled date</span>
          <input
            className="input tnum"
            type="date"
            value={cancelledDate}
            min={subscription.started_date || undefined}
            onChange={(e) => setCancelledDate(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            Cancel plan
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep it
          </button>
          {destructive && (
            <button type="button" className="btn btn-ghost destructive" onClick={destructive.onClick}>
              {destructive.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CancelDialog;
