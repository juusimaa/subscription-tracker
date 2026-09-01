// The 20px brand tile: a letter or two, Archivo 800, on a flat brand-coloured
// square. Zero radius, like everything else in this system.
//
// Its own file because Vite's fast refresh only works on modules that export
// components and nothing else -- keeping it next to the SERVICES data would
// silently cost hot-reloading on every edit to either.

import { brandFor } from "./services";

function MonoTile({ name, brand, dim = false }) {
  const service = brand || brandFor(name);
  return (
    <span
      className="mono-tile"
      // Inline because they are per-brand data, not design tokens: the
      // stylesheet holds the shape, the catalogue holds the colours.
      style={{
        background: service.brandBg || "var(--color-neutral-700)",
        color: service.brandFg || "var(--color-bg)",
        fontSize: service.monoSize || 11,
        // Cancelled rows render muted all through, tile included.
        opacity: dim ? 0.4 : 1,
      }}
      // The name is always rendered as text beside this, so announcing the
      // tile too would just make a screen reader say it twice.
      aria-hidden="true"
    >
      {service.mono}
    </span>
  );
}

export default MonoTile;
