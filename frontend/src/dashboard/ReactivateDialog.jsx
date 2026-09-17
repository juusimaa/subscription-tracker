// Reactivation starts a linked billing run. The cancelled run keeps its paid
// history and terms; only the new row receives the values entered here.

import { useState } from "react";
import { ApiError } from "../api";
import { longDate, todayISO } from "../format";
import { TriangleAlert } from "../icons";

function ReactivateDialog({ subscription, onConfirm, onClose }) {
  const paidThrough = subscription.cancelled_date ? subscription.next_renewal_date : null;
  const plannedStart = subscription.started_date && subscription.started_date > todayISO()
    ? subscription.started_date
    : null;
  const [firstChargeDate, setFirstChargeDate] = useState(
    paidThrough && paidThrough > todayISO() ? paidThrough : plannedStart || todayISO(),
  );
  const [cost, setCost] = useState(String(subscription.cost));
  const [cycle, setCycle] = useState(subscription.billing_cycle);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!(Number(cost) > 0)) {
      setError("Cost must be greater than 0.");
      return;
    }
    if (!firstChargeDate) {
      setError("Choose the first charge date.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm({
        cost: Number(cost),
        billing_cycle: cycle,
        started_date: firstChargeDate,
        next_renewal_date: firstChargeDate,
      });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} ${err.status} — nothing was saved.` : err.message);
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
        aria-label={`Reactivate ${subscription.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">Reactivate {subscription.name}</p>
        <p className="dialog-body">
          The previous run and its charges stay in your history. Set the terms for the new run.
        </p>
        <div className="reactivation-fields">
          <label className="field">
            <span className="field-label">Cost</span>
            <input
              className="input tnum"
              type="number"
              min="0.01"
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Cycle</span>
            <select className="input" value={cycle} onChange={(event) => setCycle(event.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        </div>
        <div className="reactivation-fields">
          <label className="field">
            <span className="field-label">First charge date</span>
            <input
              className="input tnum"
              type="date"
              value={firstChargeDate}
              onChange={(event) => setFirstChargeDate(event.target.value)}
            />
          </label>
        </div>
        {paidThrough && paidThrough > todayISO() && (
          <p className="reactivation-note">Previously paid through {longDate(paidThrough)}.</p>
        )}
        {error && <p role="alert" className="form-error"><TriangleAlert /><span>{error}</span></p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            Reactivate
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReactivateDialog;
