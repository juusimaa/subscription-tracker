import { ApproxMark } from "../Approx";
import { t } from "../i18n";

// Four figures across the page, separated by hairlines. Each one answers a
// question the headline total cannot: what is about to leave the account, how
// many charges there are, which is the biggest, and which way the trend went.

// A money figure that may break after a thousands separator, and nowhere
// else, when its column is too narrow for it.
export function Figure({ text }) {
  const groups = text.split(/(?<=,)/);
  return groups.map((group, index) => (
    <span key={index}>
      {index > 0 && <wbr />}
      <span className="figure-group">{group}</span>
    </span>
  ));
}

// Past this many characters a figure steps down a size before it has to
// break: "€1,234.56" fits a quarter of the band, "€101,234,567.88" does not.
const LONG_FIGURE = 10;

function KpiBand({ cells }) {
  return (
    <section aria-label={t("kpi.label")} className="kpis">
      {cells.map((cell) => (
        <div className="kpi" key={cell.label}>
          <p className={cell.figure.length > LONG_FIGURE ? "kpi-figure long" : "kpi-figure"}>
            {cell.approx && <ApproxMark />}
            <Figure text={cell.figure} />
          </p>
          <p className="kpi-label">{cell.label}</p>
          {cell.note && <p className="kpi-note">{cell.note}</p>}
        </div>
      ))}
    </section>
  );
}

export default KpiBand;
