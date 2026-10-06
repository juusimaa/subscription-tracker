// The headline: what the selected period costs, in the largest type on the
// page, with the period controls beside it. Children (the next-charge strip)
// span the full width under both, still above the fold.

import { monthName, money } from "../format";
import { t } from "../i18n";
import { Figure } from "./KpiBand";
import PeriodControls from "./PeriodControls";

function Hero({ view, year, month, total, activeCount, categoryCount, children, ...periodProps }) {
  const monthly = view === "monthly";
  return (
    <section id="overview" className="hero">
      <div>
        <h1 className="eyebrow">
          {monthly ? t("hero.monthlySpend") : t("hero.annualSpend")} ·{" "}
          {monthly ? t("period.monthYear", { month: monthName(month), year }) : year}
        </h1>
        <p className="hero-total"><Figure text={money(total)} /></p>
        <p className="hero-body">
          {t("hero.body", { active: activeCount, categories: categoryCount, monthly })}
        </p>
      </div>
      <PeriodControls view={view} year={year} month={month} {...periodProps} />
      {children}
    </section>
  );
}

export default Hero;
