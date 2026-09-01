// Catalogue of well-known subscriptions: the brand tile drawn beside a name,
// and a typical price for the quick-add tiles in the empty state.
//
// Nothing here is stored in the database. The API has no home for `mono`,
// `brandBg`, `brandFg` or `monoSize` -- a client-side lookup keyed on name is
// the right call unless they should be per-subscription and editable, in which
// case they are four nullable columns (TODO.md D7). That is what makes this
// list cheap to change: adding a service or fixing a price is an edit to this
// file, never a migration, and existing rows are unaffected.
//
// Tiles are typographic, not logos: a letter or two on a 20px zero-radius
// square in the brand colour. A traced logomark per service is a lot of SVG to
// carry (and to keep current) at that size, and initials are just as
// recognisable. The brand colours are literal and intentional, straight from
// the design.

export const SERVICES = [
  { name: "Netflix", mono: "N", brandBg: "#e50914", brandFg: "#fff", monoSize: 11, monthlyCost: "13.99" },
  { name: "Spotify", mono: "S", brandBg: "#1db954", brandFg: "#fff", monoSize: 11, monthlyCost: "11.99" },
  { name: "Spotify Family", mono: "S", brandBg: "#1db954", brandFg: "#fff", monoSize: 11, monthlyCost: "17.99" },
  { name: "Disney+", mono: "D+", brandBg: "#113ccf", brandFg: "#fff", monoSize: 9, monthlyCost: "9.99" },
  { name: "HBO Max", mono: "HBO", brandBg: "#7b2bf9", brandFg: "#fff", monoSize: 7, monthlyCost: "9.99" },
  { name: "iCloud+", mono: "i", monthlyCost: "2.99" },
  { name: "Figma", mono: "F", monthlyCost: "15.00" },
  { name: "Notion", mono: "N", monthlyCost: "8.00" },
  { name: "Basic-Fit", mono: "B", brandBg: "var(--color-accent)", brandFg: "var(--color-bg)", monoSize: 11, monthlyCost: "24.99" },
];

// The eight one-tap tiles the empty state offers, in the design's order.
// Hardcoded here because that is the honest v1: STATES.md wants a curated
// catalogue ranked by popularity in the user's region, which is an endpoint if
// it is ever real (TODO.md D7).
export const QUICK_ADD = [
  "Netflix", "Spotify", "Disney+", "HBO Max", "iCloud+", "Figma", "Notion", "Basic-Fit",
].map((name) => SERVICES.find((service) => service.name === name));

// Matched on name because the name is all the database keeps -- there is no
// service id on the row. Prefix matching, so "Netflix Standard" and "Spotify
// Family" both find their brand; longest entry wins, so "Spotify Family" is
// not claimed by the shorter "Spotify".
export function findService(name) {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  let best;
  for (const service of SERVICES) {
    const candidate = service.name.toLowerCase();
    if (needle === candidate || needle.startsWith(`${candidate} `)) {
      if (!best || candidate.length > best.name.length) best = service;
    }
  }
  return best;
}

// Everything the tile needs for one subscription, catalogued or not. An
// unknown service still gets a tile -- its first letter on the neutral
// default -- so the name column keeps one shape down the whole table.
export function brandFor(name) {
  const service = findService(name);
  if (service) return service;
  return { mono: (name || "?").trim().charAt(0).toUpperCase() || "?" };
}
