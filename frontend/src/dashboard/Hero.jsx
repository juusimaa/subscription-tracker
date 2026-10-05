// The headline: what the selected period costs, in the largest type on the
// page, with the period controls beside it. Children (the next-charge strip)
// span the full width under both, still above the fold.

import { MONTHS, money } from "../format";
import { Figure } from "./KpiBand";
import PeriodControls from "./PeriodControls";

function Hero({ view, year, month, total, activeCount, categoryCount, children, ...periodProps }) {
  const monthly = view === "monthly";
  return (
    <section id="overview" className="hero">
      <div>
        <h1 className="eyebrow">
          {monthly ? "Monthly spend" : "Annual spend"} · {monthly ? `${MONTHS[month]} ${year}` : year}
        </h1>
        <p className="hero-total"><Figure text={money(total)} /></p>
        <p className="hero-body">
          Across {activeCount} active subscription{activeCount === 1 ? "" : "s"} in {categoryCount}{" "}
          categor{categoryCount === 1 ? "y" : "ies"}.{" "}
          {monthly
            ? "A yearly plan counts in full in the month it renews;"
            : "Monthly plans are shown at twelve times their charge;"}{" "}
          trials, paused and cancelled plans are excluded until they charge.
        </p>
      </div>
      <PeriodControls view={view} year={year} month={month} {...periodProps} />
      {children}
    </section>
  );
}

export default Hero;
