// The charges falling in the selected month, in date order.
//
// A trial shows €0.00 and says so: nothing leaves the account on a conversion
// day, the trial is free until it ends. Its real price is in the table and in
// the banner, which is where "then €9.99/mo" belongs.

import { Fragment } from "react";
import { money, shortDate } from "../format";

function ComingUp({ charges, note }) {
  return (
    <div className="split-right">
      <span className="eyebrow" style={{ margin: "0 0 28px" }}>Coming up</span>
      {/* A three-column grid rather than three stacked lists, so date, name
          and amount share one baseline and one set of row rules. */}
      <div className="coming-up">
        {charges.map((charge, index) => {
          const first = index === 0 ? " first" : "";
          return (
            <Fragment key={`${charge.subscription.id}-${charge.iso}`}>
              <span className={`date${first}`}>{shortDate(charge.iso)}</span>
              <span className={`name${first}`}>
                {charge.subscription.name}
                {charge.isTrialConversion && <span className="trial-note">trial converts</span>}
              </span>
              <span className={`amount${first}`}>{money(charge.cost)}</span>
            </Fragment>
          );
        })}
      </div>
      {charges.length === 0 && <p className="cat-members">No charges in this period.</p>}
      <p className="panel-note">{note}</p>
    </div>
  );
}

export default ComingUp;
