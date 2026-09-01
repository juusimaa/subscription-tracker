// Shown whenever any trial is running, because the day a trial converts is
// the one date on this page that costs money without anyone deciding to spend
// it. "Review trials" sorts the table by status, which groups them together.

import { longDate, money } from "../format";

function TrialBanner({ trials, year, month, onReview }) {
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

  const detail = trials
    .map(
      (trial) =>
        `${trial.name} — ${money(trial.cost)}${
          trial.billing_cycle === "yearly" ? "/yr from " : "/mo from "
        }${longDate(trial.next_renewal_date)}`,
    )
    .join("   ·   ");

  return (
    <section aria-label="Trials converting soon" className="trial-banner">
      <div className="trial-banner-inner">
        <div>
          <p className="trial-headline">{headline}</p>
          <p className="trial-detail">{detail}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onReview}>
          Review trials
        </button>
      </div>
    </section>
  );
}

export default TrialBanner;
