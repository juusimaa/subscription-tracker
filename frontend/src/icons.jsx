// The four Lucide icons the design uses, as inline SVG.
//
// The handoff says to pull these from the codebase's Lucide package; there
// isn't one, and adding a dependency to draw four glyphs at 14-20px is a worse
// trade than the ~10 lines here. The paths are Lucide's own, at the design's
// stroke-width 2 / square caps / no fill.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "square",
  "aria-hidden": true,
};

export function TriangleAlert({ size = 16, color = "var(--color-accent)" }) {
  return (
    <svg {...base} width={size} height={size} stroke={color}>
      <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

export function Calendar({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3" y="4" width="18" height="18" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  );
}

export function ChevronLeft({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function GitHub({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size} fill="currentColor" stroke="none">
      <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.52.1.72-.23.72-.5v-1.95c-2.93.64-3.55-1.31-3.55-1.31-.48-1.22-1.17-1.55-1.17-1.55-.96-.65.07-.64.07-.64 1.06.07 1.62 1.09 1.62 1.09.94 1.61 2.46 1.15 3.06.88.1-.68.37-1.15.67-1.42-2.34-.27-4.8-1.17-4.8-5.2 0-1.15.41-2.09 1.08-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.26 0c2.01-1.36 2.89-1.08 2.89-1.08.57 1.45.21 2.52.1 2.79.68.73 1.08 1.67 1.08 2.82 0 4.04-2.46 4.93-4.81 5.19.38.33.71.97.71 1.96v2.9c0 .27.2.6.73.5A10.5 10.5 0 0 0 12 1.5Z" />
    </svg>
  );
}
