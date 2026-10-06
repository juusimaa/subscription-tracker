// The headline: what the selected period costs, in the largest type on the
// page, with the period controls beside it. Children (the next-charge strip)
// span the full width under both, still above the fold.
//
// When the period holds charges in another currency than the user's, the
// total is converted and marked "≈", and a short statement under the prose
// says what charged in each currency (PLAN.md milestone 10).

import { Fragment } from "react";
import { ApproxMark, Converted } from "../Approx";
import { longDate, monthName, money } from "../format";
import { inCurrency, userCurrency } from "../fx";
import { t } from "../i18n";
import { Figure } from "./KpiBand";
import PeriodControls from "./PeriodControls";

// The ruled three-column statement: code, what charged in it, and that in
// the user's currency. The user's own currency leads (the server orders it).
function CurrencyBreakdown({ lines, ratesAsOf, ratesStale }) {
  const own = userCurrency();
  const anyConverted = lines.some((line) => line.currency !== own && line.converted != null);
  const note = !anyConverted
    ? t("fx.noteNone")
    : ratesStale
      ? t("fx.noteStale", { date: longDate(ratesAsOf) })
      : t("fx.note", { date: longDate(ratesAsOf) });
  return (
    <div className="fx-breakdown">
      <span className="field-label" id="fx-breakdown-label">{t("fx.breakdownLabel")}</span>
      {/* Read in order -- code, amount, converted -- which is how the
          statement reads aloud too, so the grid needs no table roles. */}
      <div className="fx-grid" aria-labelledby="fx-breakdown-label" role="group">
        {lines.map((line) => (
          <Fragment key={line.currency}>
            <span className="code">{line.currency}</span>
            <span className="native">{money(line.native, line.currency)}</span>
            <span className="converted">
              {line.currency === own ? null : line.converted == null ? (
                t("fx.notConverted")
              ) : (
                <Converted amount={line.converted} className="" />
              )}
            </span>
          </Fragment>
        ))}
      </div>
      <p className="fx-note">{note}</p>
    </div>
  );
}

function Hero({
  view,
  year,
  month,
  total,
  activeCount,
  categoryCount,
  currencyCount = 1,
  byCurrency = [],
  ratesAsOf,
  ratesStale,
  children,
  ...periodProps
}) {
  const monthly = view === "monthly";
  const converted = byCurrency.some((line) => line.currency !== userCurrency());
  return (
    <section id="overview" className="hero">
      <div>
        <h1 className="eyebrow">
          {monthly ? t("hero.monthlySpend") : t("hero.annualSpend")} ·{" "}
          {monthly ? t("period.monthYear", { month: monthName(month), year }) : year}
        </h1>
        <p className="hero-total">
          {converted && <ApproxMark />}
          <Figure text={money(total)} />
        </p>
        <p className="hero-body">
          {t("hero.body", {
            active: activeCount,
            categories: categoryCount,
            monthly,
            currencies: currencyCount,
            shownIn: inCurrency(),
          })}
        </p>
        {converted && <CurrencyBreakdown lines={byCurrency} ratesAsOf={ratesAsOf} ratesStale={ratesStale} />}
      </div>
      <PeriodControls view={view} year={year} month={month} {...periodProps} />
      {children}
    </section>
  );
}

export default Hero;
