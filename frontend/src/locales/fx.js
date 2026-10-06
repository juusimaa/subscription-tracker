// Currencies and exchange rates (PLAN.md milestone 10): the "≈" marking a
// converted figure, the per-currency statement under the hero, the add form's
// currency, and the Account dialog's Currency section.

export default {
  en: {
    // Read by screen readers in place of the "≈" glyph, which is hidden.
    "fx.about": "about",
    "fx.inCurrency": ({ name }) => `in ${name}`,
    "fx.breakdownLabel": "In each currency",
    "fx.notConverted": "not converted yet",
    "fx.note": ({ date }) =>
      "Converted at European Central Bank reference rates: a charge already taken at its own day's rate, " +
      `one still to come at the latest rate (${date}).`,
    "fx.noteStale": ({ date }) =>
      "Converted at European Central Bank reference rates: a charge already taken at its own day's rate, " +
      `one still to come at the latest rate we have (${date}). Newer rates couldn't be fetched, ` +
      "so charges still to come may be off by a little.",
    "fx.noteNone":
      "No exchange rate could be fetched yet, so charges in other currencies are left out of the total until one can.",
    "fx.rateOnly": ({ month, year }) => `The same charges as ${month ?? year}. The difference is the exchange rate.`,
    "fx.currency": "Currency",
    "fx.addHint": ({ shownIn }) => `Totals show it ${shownIn}, at the ECB rate.`,
    "fx.locked":
      "The currency is set when a subscription is added and doesn't change after that, because its past charges " +
      "were in that currency. If a service starts billing in another currency, cancel it and reactivate it in the new " +
      "one: the two runs group together, like any restart.",
    "fx.lockedShort": "Fixed once added",
    "fx.billedIn": "Billed in",
    "fx.costIn": ({ name }) => `Cost in ${name}`,

    "account.currency": "Currency",
    "account.currencyNote":
      "Totals, the chart and categories are shown in this currency, and new subscriptions start in it. " +
      "Each subscription keeps the currency it's billed in.",
    "account.currencySaved": ({ shownIn }) => `Saved. Totals now show ${shownIn}.`,
    "account.ratesNote": ({ date }) =>
      `Exchange rates: European Central Bank reference rates, published each working day. Latest: ${date}.`,
    "account.ratesNoteStale": ({ date }) =>
      `Exchange rates: European Central Bank reference rates. Latest we have: ${date}. Newer rates couldn't be fetched just now.`,
    "account.ratesNoteNone":
      "Exchange rates: European Central Bank reference rates, fetched when a subscription in another currency needs them.",

    "backup.badCurrency": ({ where, value }) =>
      `${where}: “${value}” is not a currency this app can convert. Use a code such as EUR, USD or GBP.`,
    "listGuide.approx":
      "A figure converted into your currency at the European Central Bank's reference rate: a charge already taken " +
      "at its own day's rate, one still to come at the latest. Totals are always in your currency; a subscription's " +
      "own cost stays in the currency it bills in.",
  },
  fi: {
    "fx.about": "noin",
    "fx.inCurrency": ({ name }) => name,
    "fx.breakdownLabel": "Valuutoittain",
    "fx.notConverted": "ei vielä muunnettu",
    "fx.note": ({ date }) =>
      "Muunnettu Euroopan keskuspankin viitekursseilla: jo veloitettu maksu oman päivänsä kurssilla, " +
      `tuleva maksu uusimmalla kurssilla (${date}).`,
    "fx.noteStale": ({ date }) =>
      "Muunnettu Euroopan keskuspankin viitekursseilla: jo veloitettu maksu oman päivänsä kurssilla, " +
      `tuleva maksu uusimmalla saatavilla olevalla kurssilla (${date}). Uudempia kursseja ei saatu haettua, ` +
      "joten tulevat maksut voivat heittää hieman.",
    "fx.noteNone":
      "Valuuttakursseja ei ole vielä saatu haettua, joten muiden valuuttojen maksut jäävät yhteissummasta pois, kunnes kurssi saadaan.",
    "fx.rateOnly": ({ month, year }) =>
      `Samat maksut kuin ${month ? `${month}ssa` : `vuonna ${year}`}. Ero johtuu valuuttakurssista.`,
    "fx.currency": "Valuutta",
    "fx.addHint": ({ shownIn }) => `Yhteissummissa se muunnetaan valuuttaan ${shownIn} EKP:n kurssilla.`,
    "fx.locked":
      "Valuutta valitaan, kun tilaus lisätään, eikä sitä voi muuttaa jälkeenpäin, koska tilauksen aiemmat maksut " +
      "veloitettiin siinä valuutassa. Jos palvelu alkaa laskuttaa toisessa valuutassa, lopeta tilaus ja aktivoi se " +
      "uudelleen uudessa valuutassa: jaksot ryhmitellään yhteen kuten muutkin uudelleenaloitukset.",
    "fx.lockedShort": "Ei muutettavissa lisäämisen jälkeen",
    "fx.billedIn": "Laskutusvaluutta",
    "fx.costIn": ({ name }) => `Hinta, ${name}`,

    "account.currency": "Valuutta",
    "account.currencyNote":
      "Yhteissummat, kaavio ja kategoriat näytetään tässä valuutassa, ja uudet tilaukset alkavat siinä. " +
      "Jokainen tilaus pysyy siinä valuutassa, jossa se laskutetaan.",
    "account.currencySaved": ({ shownIn }) => `Tallennettu. Yhteissummat näytetään nyt valuutassa ${shownIn}.`,
    "account.ratesNote": ({ date }) =>
      `Valuuttakurssit: Euroopan keskuspankin viitekurssit, julkaistaan pankkipäivittäin. Uusin: ${date}.`,
    "account.ratesNoteStale": ({ date }) =>
      `Valuuttakurssit: Euroopan keskuspankin viitekurssit. Uusin saatavilla oleva: ${date}. Uudempia kursseja ei juuri nyt saatu haettua.`,
    "account.ratesNoteNone":
      "Valuuttakurssit: Euroopan keskuspankin viitekurssit, haetaan kun jokin tilaus toisessa valuutassa tarvitsee niitä.",

    "backup.badCurrency": ({ where, value }) =>
      `${where}: ”${value}” ei ole valuutta, jota sovellus osaa muuntaa. Käytä koodia kuten EUR, USD tai GBP.`,
    "listGuide.approx":
      "Omaan valuuttaasi muunnettu luku Euroopan keskuspankin viitekurssilla: jo veloitettu maksu oman päivänsä " +
      "kurssilla, tuleva uusimmalla. Yhteissummat ovat aina omassa valuutassasi; tilauksen oma hinta pysyy siinä " +
      "valuutassa, jossa se laskutetaan.",
  },
};
