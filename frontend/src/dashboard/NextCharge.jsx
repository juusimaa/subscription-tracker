// The next money to leave the account, just under the headline. The trial
// banner further down has the full picture; this strip exists so that the
// soonest charge, and the one surprise a trial conversion can spring, are
// both on screen without scrolling.
//
// It answers a question about today, so it ignores the period picker the
// same way the "next 30 days" KPI does. Its first row is the soonest charge of
// any kind. When a trial converts later than that, it gets a row of its own:
// a conversion is the one charge nobody decided on, so it should not be
// pushed out of sight by an ordinary renewal a few days earlier.

import { useState } from "react";
import { describeWriteError } from "../api";
import { cycleSuffix, money, shortDate, todayISO } from "../format";
import { TriangleAlert } from "../icons";

function daysUntil(iso, today) {
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function NextCharge({ subscriptions, onConvert, onCancel }) {
  // Same double-tap guard as the trial banner's: converting has no confirm.
  const [convertingId, setConvertingId] = useState(null);
  const [failure, setFailure] = useState(null);

  const today = todayISO();
  const due = subscriptions
    .filter((s) => (s.status === "active" || s.status === "trial") && s.next_renewal_date >= today)
    .sort((a, b) => a.next_renewal_date.localeCompare(b.next_renewal_date) || a.name.localeCompare(b.name));
  if (due.length === 0) return null;

  const next = due[0];
  const trial = due.find((s) => s.status === "trial");
  const rows = [next, ...(trial && trial !== next ? [trial] : [])];

  async function convert(subscription) {
    if (convertingId != null) return;
    setConvertingId(subscription.id);
    setFailure(null);
    try {
      await onConvert(subscription);
    } catch (err) {
      setFailure({ id: subscription.id, message: describeWriteError(err) });
    } finally {
      setConvertingId(null);
    }
  }

  return (
    <section aria-label="Next charge" className="next-charge">
      {rows.map((s) => {
        const isTrial = s.status === "trial";
        return (
          <div key={s.id} className="next-charge-row" aria-busy={convertingId === s.id || undefined}>
            <p className="next-charge-label">{isTrial ? "Trial converts" : "Next charge"}</p>
            <p className="next-charge-what">
              <span className="next-charge-name">{s.name}</span>{" "}
              <span className="next-charge-amount">
                {money(s.cost)}
                {isTrial && cycleSuffix(s.billing_cycle)}
                {isTrial && <>{" "}<span className="if-kept">if kept</span></>}
              </span>{" "}
              <span className="next-charge-when">
                {shortDate(s.next_renewal_date)}, {daysUntil(s.next_renewal_date, today)}
              </span>
            </p>
            <div className="next-charge-actions">
              {isTrial && (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={convertingId != null}
                  onClick={() => convert(s)}
                >
                  {convertingId === s.id ? "Converting…" : "Convert to paid"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={convertingId === s.id}
                onClick={() => onCancel(s)}
              >
                {isTrial ? "Cancel before it charges" : "Cancel"}
              </button>
            </div>
            {failure?.id === s.id && (
              <p role="alert" className="next-charge-error">
                <TriangleAlert size={16} />
                <span>{failure.message}</span>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default NextCharge;
