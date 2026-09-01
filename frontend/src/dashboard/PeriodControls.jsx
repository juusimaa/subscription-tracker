// The "View" cluster in the top right of the hero: Monthly/Yearly, a period
// stepper, and the popover that picks a period directly.
//
// One selection drives the whole page. Every control here -- and the trend
// bars elsewhere -- writes the same { period, year, month } and closes the
// popover, so the headline, KPIs, category bars and Coming up list can never
// disagree about which period is on screen.

import { Calendar, ChevronLeft, ChevronRight } from "../icons";
import { MAX_YEAR, MIN_YEAR, MONTHS, SHORT_MONTHS } from "../format";

function PeriodControls({ view, year, month, onChange, pickerOpen, setPickerOpen }) {
  const monthly = view === "monthly";
  const label = monthly ? `${MONTHS[month]} ${year}` : String(year);

  // Stepping past a boundary is a no-op, and the button that would do it is
  // disabled -- clamping silently would leave the arrow looking live.
  const atMin = monthly ? year === MIN_YEAR && month === 0 : year === MIN_YEAR;
  const atMax = monthly ? year === MAX_YEAR && month === 11 : year === MAX_YEAR;

  function step(direction) {
    if (!monthly) {
      const next = year + direction;
      if (next < MIN_YEAR || next > MAX_YEAR) return;
      onChange({ year: next });
      return;
    }
    let m = month + direction;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    if (y < MIN_YEAR || y > MAX_YEAR) return;
    onChange({ year: y, month: m });
  }

  return (
    <div className="period">
      <span className="field-label">View</span>
      <div className="period-controls">
        <div className="seg" role="group" aria-label="Spending period">
          <button
            type="button"
            className="seg-opt"
            aria-pressed={monthly}
            onClick={() => onChange({ view: "monthly" })}
          >
            Monthly
          </button>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={!monthly}
            onClick={() => onChange({ view: "yearly" })}
          >
            Yearly
          </button>
        </div>

        <div className="stepper">
          <button
            type="button"
            className="stepper-arrow"
            onClick={() => step(-1)}
            disabled={atMin}
            aria-label="Previous period"
            title="Previous"
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="stepper-label"
            onClick={() => setPickerOpen(!pickerOpen)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <Calendar />
            <span>{label}</span>
          </button>
          <button
            type="button"
            className="stepper-arrow"
            onClick={() => step(1)}
            disabled={atMax}
            aria-label="Next period"
            title="Next"
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <div className="picker" role="dialog" aria-label="Select period">
          {monthly ? (
            <>
              <div className="picker-year">
                <button
                  type="button"
                  onClick={() => onChange({ year: Math.max(MIN_YEAR, year - 1) }, { keepPicker: true })}
                  disabled={year === MIN_YEAR}
                  aria-label="Previous year"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>{year}</span>
                <button
                  type="button"
                  onClick={() => onChange({ year: Math.min(MAX_YEAR, year + 1) }, { keepPicker: true })}
                  disabled={year === MAX_YEAR}
                  aria-label="Next year"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="picker-grid months">
                {SHORT_MONTHS.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={index === month}
                    onClick={() => onChange({ month: index })}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <span className="field-label" style={{ marginBottom: 16 }}>Select year</span>
              <div className="picker-grid years">
                {Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map((y) => (
                  <button key={y} type="button" aria-pressed={y === year} onClick={() => onChange({ year: y })}>
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default PeriodControls;
