// Catalogue of well-known subscriptions offered in the name picker, so adding
// Netflix is one click instead of typing the name and looking up the price.
//
// Nothing here is stored in the database. Picking a service just pre-fills the
// form, and every field stays editable before saving -- the backend only ever
// sees the plain name and cost that the form submits. That's what makes this
// list cheap to change: adding a service or fixing a price is an edit to this
// file, never a migration, and existing rows are unaffected.

// The standard ad-free monthly plan in EUR at the time of writing. These drift
// constantly; they're defaults to save typing, not a live price feed.
//
// `mark` is the monogram drawn in the icon below and `color` the brand colour
// behind it. Deliberately not the real logos: a traced logomark per service is
// a lot of SVG to carry (and to keep current) for a 20px tile, and initials in
// the brand colour are just as recognisable at that size.
export const SERVICES = [
  { name: "Netflix", monthlyCost: "13.99", mark: "N", color: "#e50914" },
  { name: "Disney+", monthlyCost: "9.99", mark: "D+", color: "#113ccf" },
  { name: "HBO", monthlyCost: "9.99", mark: "HBO", color: "#7b2bf9" },
];

// Matched on name because the name is all the database keeps -- there's no
// service id on the row. That means renaming an entry above orphans the icon
// on subscriptions already saved under the old name (they still work, they
// just lose the tile), which is the trade for not needing a schema change.
export function findService(name) {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  return SERVICES.find((service) => service.name.toLowerCase() === needle);
}
