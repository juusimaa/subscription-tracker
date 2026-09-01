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
