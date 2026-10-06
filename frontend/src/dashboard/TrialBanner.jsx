// Shown whenever any trial is running, because the day a trial converts is
// the one date on this page that costs money without anyone deciding to spend
// it. Each trial gets its own row with the two actions that actually matter
// at that moment -- keep it, or kill it before it charges -- rather than
// making "Review trials" the only way to reach either from here.

import { useState } from "react";
import { describeWriteError } from "../api";
import { cycleSuffix, longDate, money } from "../format";
import { t } from "../i18n";
import { TriangleAlert } from "../icons";

function TrialBanner({ trials, year, month, onReview, onConvert, onCancel }) {
  // Converting is one tap with no confirm, so it is the one write on this
  // page that a double tap would send twice. Which trial is converting, and
  // which one failed and why, both live on that trial's own row.
  const [convertingId, setConvertingId] = useState(null);
  const [failure, setFailure] = useState(null);

  async function convert(trial) {
    if (convertingId != null) return;
    setConvertingId(trial.id);
    setFailure(null);
    try {
      await onConvert(trial);
    } catch (err) {
      setFailure({ id: trial.id, message: describeWriteError(err) });
    } finally {
      setConvertingId(null);
    }
  }

  const converting = trials.filter((trial) => {
    const [y, m] = trial.next_renewal_date.split("-").map(Number);
    return y === year && m - 1 === month;
  });

  const headline =
    converting.length === 1
      ? t("trial.headlineOne", { name: converting[0].name, date: longDate(converting[0].next_renewal_date) })
      : converting.length > 1
        ? t("trial.headlineMany", { n: converting.length })
        : t("trial.headlineNone", { n: trials.length });

  return (
    <section aria-label={t("trial.label")} className="trial-banner">
      <div className="section-head trial-head">
        <p className="trial-headline">{headline}</p>
        <button type="button" className="btn btn-ghost trial-review" onClick={onReview}>
          {t("trial.review")}
        </button>
      </div>
      <ul className="trial-list">
        {trials.map((trial) => (
          <li key={trial.id} className="trial-row" aria-busy={convertingId === trial.id || undefined}>
            <div>
              <p className="trial-row-name">{trial.name}</p>
              <p className="trial-row-detail tnum">
                {t("trial.rowDetail", {
                  price: money(trial.cost) + cycleSuffix(trial.billing_cycle),
                  date: longDate(trial.next_renewal_date),
                })}
              </p>
            </div>
            <div className="trial-row-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={convertingId != null}
                onClick={() => convert(trial)}
              >
                {convertingId === trial.id ? t("trial.converting") : t("trial.convert")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={convertingId === trial.id}
                onClick={() => onCancel(trial)}
              >
                {t("trial.cancelBefore")}
              </button>
            </div>
            {failure?.id === trial.id && (
              <p role="alert" className="trial-row-error">
                <TriangleAlert size={16} />
                <span>{failure.message}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TrialBanner;
