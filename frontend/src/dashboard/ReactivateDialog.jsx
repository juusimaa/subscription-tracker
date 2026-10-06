// Reactivation starts a linked billing run. The cancelled run keeps its paid
// history and terms; only the new row receives the values entered here.

import { useState } from "react";
import { describeWriteError } from "../api";
import { costProblem, cycleLabel, longDate, parseAmount, todayISO } from "../format";
import { CURRENCIES } from "../fx";
import { t } from "../i18n";
import { TriangleAlert } from "../icons";
import { useModal } from "../useModal";

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
  // The one place a service's currency can change: a new run starts in it,
  // and the cancelled run keeps the one its charges were taken in.
  const [currency, setCurrency] = useState(subscription.currency ?? "EUR");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useModal(busy ? undefined : onClose);

  async function confirm() {
    const costError = costProblem(cost);
    if (costError) {
      setError(t("reactivate.costError", { error: costError }));
      return;
    }
    if (!firstChargeDate) {
      setError(t("reactivate.dateRequired"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm({
        cost: parseAmount(cost),
        currency,
        billing_cycle: cycle,
        started_date: firstChargeDate,
        next_renewal_date: firstChargeDate,
      });
    } catch (err) {
      setError(describeWriteError(err));
    } finally {
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
        aria-label={t("reactivate.title", { name: subscription.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{t("reactivate.title", { name: subscription.name })}</p>
        <p className="dialog-body">{t("reactivate.body")}</p>
        <div className="reactivation-fields">
          <div className="field">
            <label className="field-label" htmlFor="reactivate-cost">{t("reactivate.cost")}</label>
            <span className="money-field">
              <input
                id="reactivate-cost"
                className="input tnum"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
              <select
                className="input"
                aria-label={t("fx.currency")}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </span>
          </div>
          <label className="field">
            <span className="field-label">{t("reactivate.cycle")}</span>
            <select className="input" value={cycle} onChange={(event) => setCycle(event.target.value)}>
              <option value="monthly">{cycleLabel("monthly")}</option>
              <option value="quarterly">{cycleLabel("quarterly")}</option>
              <option value="yearly">{cycleLabel("yearly")}</option>
            </select>
          </label>
        </div>
        <div className="reactivation-fields">
          <label className="field">
            <span className="field-label">{t("reactivate.firstCharge")}</span>
            <input
              className="input tnum"
              type="date"
              value={firstChargeDate}
              onChange={(event) => setFirstChargeDate(event.target.value)}
            />
          </label>
        </div>
        {paidThrough && paidThrough > todayISO() && (
          <p className="reactivation-note">{t("reactivate.paidThrough", { date: longDate(paidThrough) })}</p>
        )}
        {error && <p role="alert" className="form-error"><TriangleAlert /><span>{error}</span></p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
            {t("reactivate.confirm")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            {t("reactivate.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReactivateDialog;
