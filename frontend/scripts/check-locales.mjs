// Fails when a message key exists in one language but not the other, so a
// string added in English cannot ship without its Finnish (or vice versa).
// Run with `npm run check:locales`; CI runs it before the visual tests.

import { bundles } from "../src/locales/index.js";
import common from "../src/locales/common.js";

let problems = 0;
for (const bundle of bundles) {
  const en = new Set(Object.keys(bundle.en));
  const fi = new Set(Object.keys(bundle.fi));
  // Server details are translated one way only: English shows the server's
  // own text (see serverMessage in src/api.js).
  const oneWay = (key) => bundle === common && key.startsWith("server.");
  for (const key of en) if (!fi.has(key)) { console.error(`missing in fi: ${key}`); problems++; }
  for (const key of fi) if (!en.has(key) && !oneWay(key)) { console.error(`missing in en: ${key}`); problems++; }
}
const keys = bundles.flatMap((bundle) => Object.keys(bundle.en));
for (const key of new Set(keys.filter((key, index) => keys.indexOf(key) !== index))) {
  console.error(`defined in more than one bundle: ${key}`);
  problems++;
}
if (problems) process.exit(1);
console.log(`locales ok: ${keys.length} keys in en and fi`);
