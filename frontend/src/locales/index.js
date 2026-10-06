// Every message bundle, merged per language. Keys are prefixed by area
// ("account.", "table.", ...) so two bundles can never claim the same key;
// check-locales.mjs fails the build when a key exists in one language only.

import app from "./app.js";
import common from "./common.js";
import dialogs from "./dialogs.js";
import overview from "./overview.js";
import table from "./table.js";

const bundles = [common, app, overview, table, dialogs];

const messages = { en: {}, fi: {} };
for (const bundle of bundles) {
  for (const language of Object.keys(messages)) Object.assign(messages[language], bundle[language]);
}

export { bundles };
export default messages;
