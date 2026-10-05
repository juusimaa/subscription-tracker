// The heading of a section that folds away: the h2 holds the button, so a
// screen reader still moves to it by heading and hears whether it is open.
// The body stays mounted under `hidden` rather than unmounting, so whatever
// was typed into it survives closing and reopening.

import { ChevronRight } from "../icons";

function SectionToggle({ title, open, onToggle, controls }) {
  return (
    <h2 className="eyebrow">
      <button
        type="button"
        className="section-toggle"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        <ChevronRight size={16} />
        {title}
      </button>
    </h2>
  );
}

export default SectionToggle;
