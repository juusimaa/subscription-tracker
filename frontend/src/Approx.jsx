// The "≈" that marks a figure converted into the user's currency (PLAN.md
// milestone 10). The glyph is hidden from screen readers, which read "about"
// instead. Styling lives in dashboard.css (.approx, .fx): lighter weight and
// ink rather than the figure's own colour, so a red total stays the one red
// thing and the mark reads as a qualifier.

import { money } from "./format";
import { t } from "./i18n";

export function ApproxMark() {
  return (
    <>
      <span className="approx" aria-hidden="true">≈</span>
      <span className="sr-only">{t("fx.about")} </span>
    </>
  );
}

/** "≈ €17.05" in hint ink, after a native amount. Nothing when the amount
 * could not be converted (no rate), so a guess never appears. */
export function Converted({ amount, className = "fx" }) {
  if (amount == null) return null;
  return (
    <span className={className}>
      <ApproxMark />
      {money(amount)}
    </span>
  );
}
