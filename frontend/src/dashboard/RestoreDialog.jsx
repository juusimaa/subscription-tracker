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
        aria-label={`Start ${subscription.name} over?`}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">Start {subscription.name} over?</p>
        <p className="dialog-body">
          Begins a fresh run from today. The cancelled one stays in your history.
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
            Start over
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
