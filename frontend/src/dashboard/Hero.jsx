// The headline: what the selected period costs, in the largest type on the
// page, with the period controls beside it. Children (the next-charge strip)
// span the full width under both, still above the fold. On mobile the
// controls stack under the total and would push the strip off the first
// screen, so there the strip comes first: what can still be stopped outranks
// switching the view. Moved in the markup, not with CSS order, so focus and
// reading order follow what is on screen.
//
// When the period holds charges in another currency than the user's, the
// total is converted and marked "≈", and a short statement under the prose
// says what charged in each currency (PLAN.md milestone 10). On mobile that
// statement folds to one line: open, it pushed the next charge and the trial
// actions below the first screen, and those are what can still be stopped.

import { Fragment, useState } from "react";
import { ApproxMark, Converted } from "../Approx";
import { longDate, monthName, money } from "../format";
import { inCurrency, userCurrency } from "../fx";
import { t } from "../i18n";
import { ChevronRight } from "../icons";
import { useIsMobile } from "../useMediaQuery";
import { Figure } from "./KpiBand";
import PeriodControls from "./PeriodControls";

// The ruled three-column statement: code, what charged in it, and that in
// the user's currency. The user's own currency leads (the server orders it).
function CurrencyBreakdown({ lines, ratesAsOf, ratesStale }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const own = userCurrency();
  const anyConverted = lines.some((line) => line.currency !== own && line.converted != null);
  const note = !anyConverted
    ? t("fx.noteNone")
    : ratesStale
      ? t("fx.noteStale", { date: longDate(ratesAsOf) })
      : t("fx.note", { date: longDate(ratesAsOf) });
  return (
    <div className="fx-breakdown">
      {mobile ? (
        <button
          type="button"
          id="fx-breakdown-label"
          className="section-toggle field-label fx-toggle"
          aria-expanded={open}
          aria-controls="fx-breakdown-body"
          onClick={() => setOpen((was) => !was)}
        >
          <ChevronRight size={16} />
          {t("fx.breakdownLabel")}
          {/* Folded, the codes say what is inside without opening it. */}
          {!open && <span className="fx-codes">{lines.map((line) => line.currency).join(" · ")}</span>}
        </button>
      ) : (
        <span className="field-label" id="fx-breakdown-label">{t("fx.breakdownLabel")}</span>
      )}
      <div id="fx-breakdown-body" className="fx-breakdown-body" hidden={mobile && !open}>
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
  const mobile = useIsMobile();
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
      {mobile && children}
      <PeriodControls view={view} year={year} month={month} {...periodProps} />
      {!mobile && children}
    </section>
  );
}

export default Hero;
