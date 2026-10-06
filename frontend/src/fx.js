// Currencies and exchange rates (PLAN.md milestone 10).
//
// Each subscription keeps the currency it is billed in; every total is shown
// in the user's own currency, converted at European Central Bank reference
// rates and marked "≈". The server converts the totals it computes (spend,
// upcoming, paid to date). This module converts the per-item figures it does
// not: the "≈ €17.05" beside a native amount, and the sort order of a list
// that mixes currencies. It follows the server's rule (backend/app/fx.py)
// exactly:
//
// - A charge on a day uses the latest rate published on or before it, so a
//   Saturday uses Friday's. A charge still to come uses the latest rate.
// - A converted charge is rounded to the cent before anything adds it up.
//
// Like the interface language (i18n.js), the state lives at module level and
// is set by App during render, so a plain helper can read it without a hook
// and the render that follows a change already sees it.

import { getLanguage, getLocaleTag, t } from "./i18n";

// The ECB reference currencies, mirroring backend/app/currencies.py. Euro
// first, then the ones most likely in a European household, then the rest
// alphabetically -- the order the pickers list them in.
export const CURRENCIES = [
  "EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF", "PLN", "CZK",
  "AUD", "BRL", "CAD", "CNY", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
  "JPY", "KRW", "MXN", "MYR", "NZD", "PHP", "RON", "SGD", "THB", "TRY", "ZAR",
];

let state = { currency: "EUR", rates: {}, asOf: null, stale: false, missing: [] };

// Called by App during render with the user's currency and the payload of
// GET /rates (or null while it has not arrived, or after it failed).
export function applyFx(currency, payload) {
  state = {
    currency: currency || "EUR",
    rates: payload?.rates ?? {},
    asOf: payload?.as_of ?? null,
    stale: Boolean(payload?.stale),
    missing: payload?.missing ?? [],
  };
}

export const userCurrency = () => state.currency;
export const ratesAsOf = () => state.asOf;

/** Whether an amount in `code` needs converting to be shown in totals. */
export const isForeign = (code) => Boolean(code) && code !== state.currency;

/** Units of `code` per 1 EUR on `iso` (latest on or before it; the earliest
 * known rate for a day before the series starts). Null when there is none. */
export function rateOn(code, iso) {
  if (code === "EUR") return 1;
  const series = state.rates[code];
  if (!series || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  if (iso < series[0][0]) return series[0][1];
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (series[mid][0] <= iso) lo = mid;
    else hi = mid - 1;
  }
  return series[lo][1];
}

const roundCents = (value) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;

/**
 * `amount` of `code`, charged on `iso` (default: still to come, so the latest
 * rate), in the user's currency, rounded to the cent. Null when a rate is
 * missing -- the caller shows the native amount alone rather than a guess.
 */
export function convert(amount, code, iso = "9999-12-31") {
  const value = Number(amount) || 0;
  if (!isForeign(code)) return roundCents(value);
  const from = rateOn(code, iso);
  const to = rateOn(state.currency, iso);
  if (from == null || to == null) return null;
  return roundCents((value / from) * to);
}

/** For sorting a list that mixes currencies: the converted value, or the
 * native one when there is no rate (better a rough order than a hole). */
export function comparable(amount, code, iso) {
  const converted = convert(amount, code, iso);
  return converted ?? (Number(amount) || 0);
}

// "US dollar" / "Yhdysvaltain dollari", from the browser's own data rather
// than a table of thirty names in two languages.
export function currencyName(code) {
  try {
    const name = new Intl.DisplayNames([getLocaleTag()], { type: "currency" }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

/**
 * How a total's currency is named after it: "in euros" in English, where
 * Intl's plural name reads naturally, and the code in Finnish ("EUR"),
 * where the essive the sentence would need is not something Intl gives.
 */
export function inCurrency(code = state.currency) {
  if (getLanguage() !== "fi") {
    try {
      const parts = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        currencyDisplay: "name",
      }).formatToParts(2);
      const name = parts.find((part) => part.type === "currency")?.value;
      // Intl already cases these as English does: "euros", "US dollars".
      if (name) return t("fx.inCurrency", { name });
    } catch {
      // Fall through to the code.
    }
  }
  return t("fx.inCurrency", { name: code });
}
