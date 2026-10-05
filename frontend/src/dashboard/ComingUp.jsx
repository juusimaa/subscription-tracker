// The charges falling in the selected month, in date order.
//
// A trial shows €0.00 and says so: nothing leaves the account on a conversion
// day, the trial is free until it ends. Its real price is in the table and in
// the banner, which is where "then €9.99/mo" belongs.
//
// In the current month the list is split at today: what is still to come
// leads, and what has already been taken follows, quieter, under its own
// label. A past month is all charged and a future month is all to come, so
// those keep one list and the heading names the month instead.

import { Fragment } from "react";
import { money, shortDate } from "../format";

function ChargeGrid({ charges, past = false }) {
  // A three-column grid rather than three stacked lists, so date, name and
  // amount share one baseline and one set of row rules.
  return (
    <div className={past ? "coming-up charged" : "coming-up"}>
      {charges.map((charge, index) => {
        const first = index === 0 ? " first" : "";
        return (
          <Fragment key={`${charge.subscription.id}-${charge.iso}`}>
            <span className={`date${first}`}>{shortDate(charge.iso)}</span>
            <span className={`name${first}`}>
              {charge.subscription.name}
              {charge.isTrialConversion && <>{" "}<span className="trial-note">{past ? "trial converted" : "trial converts"}</span></>}
            </span>
            <span className={`amount${first}`}>{money(charge.cost)}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

const HEADINGS = {
  current: () => "Coming up",
  future: (month) => `Coming up · ${month}`,
  past: (month) => `Charged · ${month}`,
};

function ComingUp({ kind, monthLabel, charges, charged, note }) {
  const empty =
    kind === "current"
      ? charged.length > 0
        ? "Nothing else charges this month."
        : "No charges left this month."
      : "No charges in this period.";
  return (
    <div className="split-right">
      <h2 className="eyebrow" style={{ margin: "0 0 28px" }}>{HEADINGS[kind](monthLabel)}</h2>
      <ChargeGrid charges={charges} />
      {charges.length === 0 && <p className="cat-members">{empty}</p>}
      {charged.length > 0 && (
        <>
          <h3 className="coming-up-label">Already charged this month</h3>
          <ChargeGrid charges={charged} past />
        </>
      )}
      <p className="panel-note">{note}</p>
    </div>
  );
}

export default ComingUp;
