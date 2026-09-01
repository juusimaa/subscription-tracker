// Twelve months of the selected year, or the three years on record. Every bar
// is a button: clicking one moves the whole page to that period.
//
// The figures are the real totals for each month -- what /summary/spend says
// was actually charged, cancelled and paused plans counted up to the month
// they stopped -- not today's basket scaled by a multiplier. The prototype
// faked history that way so the strip looked plausible; a real implementation
// has the arithmetic on the server and should use it.

import { money } from "../format";

function TrendStrip({ label, bars, onSelect }) {
  // Guard the empty and all-zero cases: dividing by a zero peak would make
  // every bar NaN pixels tall.
  const peak = Math.max(0, ...bars.map((bar) => bar.value));
  const height = (bar) => (peak > 0 ? Math.round((bar.value / peak) * (bar.on ? 96 : 92)) : 0);

  return (
    <section aria-label="Spending over time" className="trend">
      <div className="section-head">
        <span className="eyebrow">{label}</span>
        <span className="hint">Click a bar to jump to it</span>
      </div>
      <div className="trend-bars">
        {bars.map((bar) => (
          <button
            key={bar.tick}
            type="button"
            title={`${bar.tick} · ${money(bar.value)}`}
            onClick={() => onSelect(bar)}
          >
            {/* Only the selected bar carries its figure; twelve numbers over
                twelve bars would be a table, not a shape. */}
            <span className="trend-value">{bar.on ? money(bar.value) : ""}</span>
            <span
              className={bar.on ? "trend-bar on" : "trend-bar"}
              style={{ height: `${height(bar)}px` }}
            />
          </button>
        ))}
      </div>
      <div className="trend-ticks">
        {bars.map((bar) => (
          <span key={bar.tick} className={bar.on ? "trend-tick on" : "trend-tick"}>
            {bar.tick}
          </span>
        ))}
      </div>
    </section>
  );
}

export default TrendStrip;
