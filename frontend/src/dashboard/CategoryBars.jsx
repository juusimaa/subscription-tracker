// Where the period's money went, one bar per category.
//
// The amounts come from the server, one /summary/spend request per category
// rather than one grouped response, because the API has no per-category
// breakdown for a period (TODO.md D3). Totalling the categories in the browser
// would only be right for the current month: it cannot reproduce the
// started/cancelled-aware arithmetic the server does for past periods, which
// is the whole reason that logic lives there. The responses are cached per
// (year, category), so stepping between months of a year costs nothing.

import { money } from "../format";

function CategoryBars({ rows, total, onManage }) {
  return (
    <div className="split-left">
      <div className="section-head">
        <span className="eyebrow">By category</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={onManage}>
          Manage
        </button>
      </div>

      {rows.length === 0 && (
        <p className="cat-members">Nothing charged in this period.</p>
      )}

      {rows.map((row, index) => {
        const share = total > 0 ? (row.amount / total) * 100 : 0;
        return (
          <div key={row.name}>
            <div className={index === 0 ? "cat-head first" : "cat-head"}>
              <span className="cat-name">{row.name}</span>
              <span className="cat-amount">
                {money(row.amount)}
                <span className="cat-share"> · {Math.round(share)}%</span>
              </span>
            </div>
            <div className="cat-track">
              <div className="cat-fill" style={{ width: `${share.toFixed(1)}%` }} />
            </div>
            <p className="cat-members">{row.members.join(" · ")}</p>
          </div>
        );
      })}
    </div>
  );
}

export default CategoryBars;
