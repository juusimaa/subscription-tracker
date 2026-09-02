// Restoring a cancelled subscription starts a brand new run linked to it --
// its own row, its own history from today -- rather than editing the old row
// in place (TODO.md item 8). Same visual family as ConfirmDialog, but this
// one needs two date inputs: the new run's start date defaults to today and
// is editable, exactly as the item asks for.

import { useState } from "react";
import { todayISO } from "../format";

function RestoreDialog({ subscription, onConfirm, onClose }) {
  const [startedDate, setStartedDate] = useState(todayISO());
  const [renewalDate, setRenewalDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm({ started_date: startedDate, next_renewal_date: renewalDate });
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
        aria-label={`Restore ${subscription.name}?`}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">Restore {subscription.name}?</p>
        <p className="dialog-body">
          Starts a new, active run of this subscription linked to its history here — the
          cancelled one stays on record with its own past charges untouched.
        </p>
        <div className="restore-dates">
          <label className="field">
            <span className="field-label">Start date</span>
            <input
              className="input tnum"
              type="date"
              value={startedDate}
              onChange={(e) => setStartedDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Renewal date</span>
            <input
              className="input tnum"
              type="date"
              value={renewalDate}
              onChange={(e) => setRenewalDate(e.target.value)}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            Restore
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default RestoreDialog;
