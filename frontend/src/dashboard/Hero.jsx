// The headline: what the selected period costs, in the largest type on the
// page, with the period controls beside it.

import { MONTHS, money } from "../format";
import PeriodControls from "./PeriodControls";

function Hero({ view, year, month, total, activeCount, categoryCount, ...periodProps }) {
  const monthly = view === "monthly";
  return (
    <section id="overview" className="hero">
      <div>
        <span className="eyebrow">
          {monthly ? "Monthly spend" : "Annual spend"} · {monthly ? `${MONTHS[month]} ${year}` : year}
        </span>
        <p className="hero-total">{money(total)}</p>
        <p className="hero-body">
          Across {activeCount} active subscription{activeCount === 1 ? "" : "s"} in {categoryCount}{" "}
          categor{categoryCount === 1 ? "y" : "ies"}.{" "}
          {monthly
            ? "Yearly plans are shown at their monthly equivalent;"
            : "Monthly plans are shown at twelve times their charge;"}{" "}
          trials, paused and cancelled plans are excluded until they charge.
        </p>
      </div>
      <PeriodControls view={view} year={year} month={month} {...periodProps} />
    </section>
  );
}

export default Hero;
