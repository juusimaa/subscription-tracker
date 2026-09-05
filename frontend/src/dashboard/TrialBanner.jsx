// Shown whenever any trial is running, because the day a trial converts is
// the one date on this page that costs money without anyone deciding to spend
// it. Each trial gets its own row with the two actions that actually matter
// at that moment -- keep it, or kill it before it charges -- rather than
// making "Review trials" the only way to reach either from here.

import { longDate, money } from "../format";

function TrialBanner({ trials, year, month, onReview, onConvert, onCancel }) {
  const converting = trials.filter((trial) => {
    const [y, m] = trial.next_renewal_date.split("-").map(Number);
    return y === year && m - 1 === month;
  });

  const headline =
    converting.length === 1
      ? `${converting[0].name} converts to a paid plan on ${longDate(converting[0].next_renewal_date)}`
      : converting.length > 1
        ? `${converting.length} trials convert to paid plans this month`
        : `${trials.length} trial${trials.length === 1 ? " is" : "s are"} running — ${
            trials.length === 1 ? "it does not convert" : "none converts"
          } this month`;

  return (
    <section aria-label="Trials converting soon" className="trial-banner">
      <p className="trial-headline">{headline}</p>
      <ul className="trial-list">
        {trials.map((trial) => (
          <li key={trial.id} className="trial-row">
            <div>
              <p className="trial-row-name">{trial.name}</p>
              <p className="trial-row-detail tnum">
                {money(trial.cost)}
                {trial.billing_cycle === "yearly" ? "/yr from " : "/mo from "}
                {longDate(trial.next_renewal_date)}
              </p>
            </div>
            <div className="trial-row-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => onConvert(trial)}>
                Convert to paid
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => onCancel(trial)}>
                Cancel before it charges
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost trial-review" onClick={onReview}>
        Review trials in the table
      </button>
    </section>
  );
}

export default TrialBanner;
