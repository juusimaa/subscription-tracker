// The subscription name field: a text input with a dropdown of known services
// under it. Not a <select>, because the name has to stay free text -- most
// subscriptions aren't in the catalogue. Not a <datalist> either, which would
// give type-or-pick for free but renders as plain strings, with nowhere to put
// an icon or a price.
//
// So it's a combobox: the input is the source of truth and accepts anything,
// and the list below is a shortcut that fills several fields at once.

import { useState } from "react";
import { SERVICES } from "./services";
import ServiceIcon from "./ServiceIcon";

function ServicePicker({ value, onChange, onPickService }) {
  const [open, setOpen] = useState(false);
  // Index into `matches` that the arrow keys are currently on. -1 means none,
  // which is the normal state while typing: the text stands on its own, and
  // Enter submits the form rather than choosing a suggestion.
  const [highlight, setHighlight] = useState(-1);

  // Typing narrows the list so the suggestions stay useful once the field has
  // text in it. Substring rather than prefix matching, so "hbo" and "max"
  // would both find an entry named "HBO Max".
  const query = value.trim().toLowerCase();
  const matches = query
    ? SERVICES.filter((service) => service.name.toLowerCase().includes(query))
    : SERVICES;

  function pick(service) {
    onPickService(service);
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Otherwise the caret jumps to the start/end of the text while the user
      // is trying to move through the list.
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wraps around, passing back through -1 on the way, so there's always a
      // way to get back to the text as typed without deleting the highlight.
      setHighlight((current) => {
        const next = current + step;
        if (next >= matches.length) return -1;
        if (next < -1) return matches.length - 1;
        return next;
      });
    } else if (e.key === "Enter" && open && highlight >= 0) {
      // Only swallowed when Enter is actually choosing something. With nothing
      // highlighted it stays the ordinary "submit the form" key.
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
      setHighlight(-1);
    }
  }

  return (
    <div className="service-picker">
      <input
        // ARIA combobox wiring: tells a screen reader that this text field
        // owns a popup list, and which option is highlighted right now.
        role="combobox"
        aria-expanded={open}
        aria-controls="service-picker-list"
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `service-option-${highlight}` : undefined}
        // The browser's own autofill dropdown would cover ours.
        autoComplete="off"
        placeholder="Name (pick or type)"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          // The filtered list just changed underneath us, so the old index
          // would now point at a different service.
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        // Closes when focus leaves, including on Tab. Safe despite the click
        // handler below, because that one prevents the input from ever losing
        // focus in the first place -- see the comment on it.
        onBlur={() => {
          setOpen(false);
          setHighlight(-1);
        }}
        onKeyDown={handleKeyDown}
        required
      />

      {open && matches.length > 0 && (
        <ul className="service-options" id="service-picker-list" role="listbox">
          {matches.map((service, index) => (
            <li
              key={service.name}
              id={`service-option-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? "highlighted" : undefined}
              // mousedown rather than click, with the default prevented: the
              // input would otherwise blur first and unmount this list before
              // the click ever landed on it.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(service);
              }}
              // Hovering moves the same highlight the arrow keys use, so mouse
              // and keyboard can never end up pointing at different rows.
              onMouseEnter={() => setHighlight(index)}
            >
              <ServiceIcon service={service} />
              <span className="service-name">{service.name}</span>
              <span className="service-cost">{service.monthlyCost} / mo</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ServicePicker;
