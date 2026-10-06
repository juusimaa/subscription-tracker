// Messages for this area of the app; see src/i18n.js for the format.
//
// The overview: the hero, the period controls, the trend strip, the KPIs,
// the category bars, Coming up, the next-charge strip, the trial banner, the
// empty state and the dashboard's own save notices.
//
// Month names arrive as vars, already in the current language (monthName in
// format.js) -- this file cannot import format.js, which imports i18n.js,
// which imports this. Finnish names are lower-case nominatives, so the
// messages capitalise them where they stand alone and inflect them where a
// sentence needs it ("syyskuussa", "elokuusta").

const plural = (n, one, other) => (n === 1 ? one : other);
const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export default {
  en: {
    // A month and year standing alone: "September 2026".
    "period.monthYear": ({ month, year }) => `${month} ${year}`,
    "period.view": "View",
    "period.spendingPeriod": "Spending period",
    "period.monthly": "Monthly",
    "period.yearly": "Yearly",
    "period.previousPeriod": "Previous period",
    "period.previous": "Previous",
    "period.nextPeriod": "Next period",
    "period.next": "Next",
    "period.choose": ({ label }) => `Choose period, currently ${label}`,
    "period.select": "Select period",
    "period.previousYear": "Previous year",
    "period.nextYear": "Next year",
    "period.selectYear": "Select year",

    "hero.monthlySpend": "Monthly spend",
    "hero.annualSpend": "Annual spend",
    "hero.body": ({ active, categories, monthly, currencies = 1 }) =>
      `Across ${active} active subscription${active === 1 ? "" : "s"} in ${categories} ` +
      `categor${categories === 1 ? "y" : "ies"}` +
      (currencies > 1 ? ` and ${currencies} currencies. ` : ". ") +
      (monthly
        ? "A yearly plan counts in full in the month it renews;"
        : "Monthly plans are shown at twelve times their charge;") +
      " trials, paused and cancelled plans are excluded until they charge.",

    "trend.label": "Spending over time",
    "trend.hint": "Click a bar to jump to it",
    "trend.perMonth": ({ year }) => `Per month · ${year}`,
    "trend.perYear": "Per year",

    "kpi.label": "Key figures",
    "kpi.next30": "Charging in the next 30 days",
    "kpi.averagePerMonth": "Average per month",
    "kpi.renewalsMonth": "Renewals this month",
    "kpi.renewalsYear": "Renewals this year",
    "kpi.largestMonth": ({ name }) => `Largest charge this month — ${name}`,
    "kpi.largestYear": ({ name }) => `Largest charge this year — ${name}`,
    "kpi.largestNone": "none",
    "kpi.noEarlier": "No earlier data",
    "kpi.changeSinceMonth": ({ shortMonth }) => `Change since ${shortMonth}`,
    "kpi.changeSinceYear": ({ year }) => `Change since ${year}`,
    "kpi.trialNoteOne": "Not counting the trial above",
    "kpi.trialNoteMany": ({ n, amount }) => `Not counting ${n} trials: ${amount} more if kept`,

    "categoryBars.title": "By category",
    "categoryBars.manage": "Manage",
    "categoryBars.nothing": "Nothing charged in this period.",
    "categoryBars.idleMonth": ({ month }) => `Nothing billed in ${month}`,
    "categoryBars.idleYear": ({ year }) => `Nothing billed in ${year}`,
    "categoryBars.uncategorised": "Uncategorised",

    "comingUp.current": "Coming up",
    "comingUp.future": ({ month }) => `Coming up · ${month}`,
    "comingUp.past": ({ month }) => `Charged · ${month}`,
    "comingUp.trialConverted": "trial converted",
    "comingUp.trialConverts": "trial converts",
    "comingUp.nothingElse": "Nothing else charges this month.",
    "comingUp.noneLeft": "No charges left this month.",
    "comingUp.none": "No charges in this period.",
    "comingUp.alreadyCharged": "Already charged this month",
    "comingUp.nextAnnual": ({ name, amount, date }) => `Next annual charge: ${name}, ${amount} on ${date}.`,
    "comingUp.noAnnual": "No annual charges on record.",

    "nextCharge.label": "Next charge",
    "nextCharge.trialConverts": "Trial converts",
    "nextCharge.today": "today",
    "nextCharge.tomorrow": "tomorrow",
    "nextCharge.inDays": ({ n }) => `in ${n} days`,
    "nextCharge.markCancelled": "Mark as cancelled",

    "trial.ifKept": "if kept",
    "trial.converting": "Converting…",
    "trial.convert": "Convert to paid",
    "trial.cancelBefore": "Cancel before it charges",
    "trial.label": "Trials converting soon",
    "trial.review": "Review trials in the table",
    "trial.headlineOne": ({ name, date }) => `${name} converts to a paid plan on ${date}`,
    "trial.headlineMany": ({ n }) => `${n} trials convert to paid plans this month`,
    "trial.headlineNone": ({ n }) =>
      `${n} trial${n === 1 ? " is" : "s are"} running — ${n === 1 ? "it does not convert" : "none converts"} this month`,
    "trial.rowDetail": ({ price, date }) => `${price} from ${date} if kept`,

    "empty.title": "Nothing tracked yet",
    "empty.total": ({ amount }) => `${amount} a month.`,
    "empty.body":
      "Add the first subscription and this page fills in — monthly and yearly totals, spend by " +
      "category, and every renewal date in order. Start with one you know off the top of your head.",
    "empty.commonLabel": "Common subscriptions",
    "empty.commonTitle": "Start from a common one",
    "empty.tileNote": ({ mobile }) =>
      `A tile fills in the ${mobile ? "add form" : "form below"} with a typical price. Check the price, then press Add.`,
    "empty.manualLabel": "Add a subscription manually",
    "empty.manualTitle": "Or add it yourself",
    "empty.manualButton": "Add it yourself",

    "dashboard.addTitle": "Add a subscription",
    "dashboard.addButton": "Add subscription",
    "dashboard.deleteTitle": ({ name }) => `Delete ${name} permanently?`,
    "dashboard.deleteBody":
      "This removes the subscription and its past charges for good. There is no undoing this from here.",
    "dashboard.deleteConfirm": "Delete permanently",

    "saveNotice.undo": "Undo",
    "saveNotice.showEnded": "Show ended",
    "saveNotice.undoFailed": ({ error }) => `Couldn't undo. ${error}`,
    "saveNotice.added": ({ name }) => `${name} added.`,
    "saveNotice.saved": ({ name }) => `${name} saved.`,
    "saveNotice.archived": ({ name }) => `${name} archived.`,
    "saveNotice.archivedHidden": ({ name }) => `${name} archived and hidden from the list.`,
    "saveNotice.backInList": ({ name }) => `${name} is back in the list.`,
    "saveNotice.archiveAllFailed": ({ error }) => `Couldn't archive every ended plan. ${error}`,
    "saveNotice.archivedMany": ({ n }) => `${n} ended plans archived.`,
    "saveNotice.archivedManyHidden": ({ n }) => `${n} ended plans archived and hidden from the list.`,
    "saveNotice.backInListMany": ({ n }) => `${n} ended plans are back in the list.`,
    "saveNotice.restored": ({ name }) => `${name} restored to the list.`,
    "saveNotice.archivedAgain": ({ name }) => `${name} archived again.`,
    "saveNotice.cancelledStays": ({ name, date }) =>
      `${name} marked as cancelled. It stays in the list until access ends ${date}.`,
    "saveNotice.cancelled": ({ name }) => `${name} marked as cancelled.`,
    "saveNotice.converted": ({ name }) => `${name} converted to paid.`,
    "saveNotice.trialAgain": ({ name }) => `${name} is a trial again.`,
    "saveNotice.deleted": ({ name }) => `${name} deleted.`,
    "saveNotice.reactivated": ({ name }) => `${name} reactivated.`,
  },

  fi: {
    "period.monthYear": ({ month, year }) => `${capitalise(month)} ${year}`,
    "period.view": "Näkymä",
    "period.spendingPeriod": "Kulujen ajanjakso",
    "period.monthly": "Kuukausi",
    "period.yearly": "Vuosi",
    "period.previousPeriod": "Edellinen ajanjakso",
    "period.previous": "Edellinen",
    "period.nextPeriod": "Seuraava ajanjakso",
    "period.next": "Seuraava",
    "period.choose": ({ label }) => `Valitse ajanjakso, nyt valittuna ${label}`,
    "period.select": "Valitse ajanjakso",
    "period.previousYear": "Edellinen vuosi",
    "period.nextYear": "Seuraava vuosi",
    "period.selectYear": "Valitse vuosi",

    "hero.monthlySpend": "Kuukauden kulut",
    "hero.annualSpend": "Vuoden kulut",
    "hero.body": ({ active, categories, monthly, currencies = 1 }) =>
      `${active} ${plural(active, "aktiivinen tilaus", "aktiivista tilausta")}, ` +
      `${categories} ${plural(categories, "kategoria", "kategoriaa")}` +
      (currencies > 1 ? `, ${currencies} valuuttaa. ` : ". ") +
      (monthly
        ? "Vuosittain laskutettava tilaus lasketaan kokonaan sille kuukaudelle, jona se uusiutuu;"
        : "Kuukausittain laskutettavat tilaukset näytetään kaksitoistakertaisina;") +
      " kokeiluja sekä tauolla olevia ja lopetettuja tilauksia ei lasketa mukaan ennen kuin niistä veloitetaan.",

    "trend.label": "Kulut ajan mittaan",
    "trend.hint": "Siirry ajanjaksoon napsauttamalla palkkia",
    "trend.perMonth": ({ year }) => `Kuukausittain · ${year}`,
    "trend.perYear": "Vuosittain",

    "kpi.label": "Tunnusluvut",
    "kpi.next30": "Veloitetaan seuraavien 30 päivän aikana",
    "kpi.averagePerMonth": "Keskimäärin kuukaudessa",
    "kpi.renewalsMonth": "Uusiutumisia tässä kuussa",
    "kpi.renewalsYear": "Uusiutumisia tänä vuonna",
    "kpi.largestMonth": ({ name }) => `Suurin veloitus tässä kuussa — ${name}`,
    "kpi.largestYear": ({ name }) => `Suurin veloitus tänä vuonna — ${name}`,
    "kpi.largestNone": "ei mitään",
    "kpi.noEarlier": "Ei aiempia tietoja",
    // Full month name in the elative: "Muutos elokuusta".
    "kpi.changeSinceMonth": ({ month }) => `Muutos ${month}sta`,
    "kpi.changeSinceYear": ({ year }) => `Muutos vuodesta ${year}`,
    "kpi.trialNoteOne": "Ei sisällä yllä olevaa kokeilua",
    "kpi.trialNoteMany": ({ n, amount }) => `Ei sisällä ${n} kokeilua: ${amount} lisää, jos pidät ne`,

    "categoryBars.title": "Kategorioittain",
    "categoryBars.manage": "Hallitse",
    "categoryBars.nothing": "Tällä ajanjaksolla ei veloitettu mitään.",
    "categoryBars.idleMonth": ({ month }) => `Ei veloituksia ${month}ssa`,
    "categoryBars.idleYear": ({ year }) => `Ei veloituksia vuonna ${year}`,
    "categoryBars.uncategorised": "Ilman kategoriaa",

    "comingUp.current": "Tulossa",
    "comingUp.future": ({ month }) => `Tulossa · ${month}`,
    "comingUp.past": ({ month }) => `Veloitettu · ${month}`,
    "comingUp.trialConverted": "kokeilu päättyi",
    "comingUp.trialConverts": "kokeilu päättyy",
    "comingUp.nothingElse": "Tässä kuussa ei ole muita veloituksia.",
    "comingUp.noneLeft": "Tässä kuussa ei ole enää veloituksia.",
    "comingUp.none": "Tällä ajanjaksolla ei ole veloituksia.",
    "comingUp.alreadyCharged": "Jo veloitettu tässä kuussa",
    "comingUp.nextAnnual": ({ name, amount, date }) => `Seuraava vuosiveloitus: ${name} ${date}, ${amount}.`,
    "comingUp.noAnnual": "Vuosiveloituksia ei ole kirjattu.",

    "nextCharge.label": "Seuraava veloitus",
    "nextCharge.trialConverts": "Kokeilu muuttuu maksulliseksi",
    "nextCharge.today": "tänään",
    "nextCharge.tomorrow": "huomenna",
    "nextCharge.inDays": ({ n }) => `${n} päivän päästä`,
    "nextCharge.markCancelled": "Merkitse lopetetuksi",

    "trial.ifKept": "jos pidät sen",
    "trial.converting": "Muutetaan…",
    "trial.convert": "Muuta maksulliseksi",
    "trial.cancelBefore": "Lopeta ennen veloitusta",
    "trial.label": "Pian päättyvät kokeilut",
    "trial.review": "Tarkastele kokeiluja taulukossa",
    "trial.headlineOne": ({ name, date }) => `${name} muuttuu maksulliseksi ${date}`,
    "trial.headlineMany": ({ n }) => `${n} kokeilua muuttuu maksullisiksi tässä kuussa`,
    "trial.headlineNone": ({ n }) =>
      n === 1
        ? "1 kokeilu on käynnissä — se ei muutu maksulliseksi tässä kuussa"
        : `${n} kokeilua on käynnissä — mikään niistä ei muutu maksulliseksi tässä kuussa`,
    "trial.rowDetail": ({ price, date }) => `${price} ${date} alkaen, jos pidät sen`,

    "empty.title": "Ei vielä seurattavia tilauksia",
    "empty.total": ({ amount }) => `${amount} kuukaudessa.`,
    "empty.body":
      "Lisää ensimmäinen tilaus, niin sivu täyttyy — kuukausi- ja vuosisummat, kulut kategorioittain " +
      "ja jokainen uusiutumispäivä järjestyksessä. Aloita jostain, jonka muistat ulkoa.",
    "empty.commonLabel": "Yleiset tilaukset",
    "empty.commonTitle": "Aloita yleisestä palvelusta",
    "empty.tileNote": ({ mobile }) =>
      `Ruutu täyttää ${mobile ? "lisäyslomakkeen" : "alla olevan lomakkeen"} tyypillisellä hinnalla. Tarkista hinta ja paina Lisää.`,
    "empty.manualLabel": "Lisää tilaus itse",
    "empty.manualTitle": "Tai lisää se itse",
    "empty.manualButton": "Lisää itse",

    "dashboard.addTitle": "Lisää tilaus",
    "dashboard.addButton": "Lisää tilaus",
    "dashboard.deleteTitle": ({ name }) => `Poistetaanko ${name} pysyvästi?`,
    "dashboard.deleteBody":
      "Tämä poistaa tilauksen ja sen aiemmat veloitukset lopullisesti. Poistoa ei voi kumota täältä.",
    "dashboard.deleteConfirm": "Poista pysyvästi",

    "saveNotice.undo": "Kumoa",
    "saveNotice.showEnded": "Näytä päättyneet",
    "saveNotice.undoFailed": ({ error }) => `Kumoaminen ei onnistunut. ${error}`,
    "saveNotice.added": ({ name }) => `${name} lisätty.`,
    "saveNotice.saved": ({ name }) => `${name} tallennettu.`,
    "saveNotice.archived": ({ name }) => `${name} arkistoitu.`,
    "saveNotice.archivedHidden": ({ name }) => `${name} arkistoitu ja piilotettu listasta.`,
    "saveNotice.backInList": ({ name }) => `${name} on taas listassa.`,
    "saveNotice.archiveAllFailed": ({ error }) => `Kaikkia päättyneitä tilauksia ei voitu arkistoida. ${error}`,
    "saveNotice.archivedMany": ({ n }) => `${n} päättynyttä tilausta arkistoitu.`,
    "saveNotice.archivedManyHidden": ({ n }) => `${n} päättynyttä tilausta arkistoitu ja piilotettu listasta.`,
    "saveNotice.backInListMany": ({ n }) => `${n} päättynyttä tilausta on taas listassa.`,
    "saveNotice.restored": ({ name }) => `${name} palautettu listaan.`,
    "saveNotice.archivedAgain": ({ name }) => `${name} arkistoitu uudelleen.`,
    "saveNotice.cancelledStays": ({ name, date }) =>
      `${name} merkitty lopetetuksi. Se pysyy listassa, kunnes käyttöoikeus päättyy ${date}.`,
    "saveNotice.cancelled": ({ name }) => `${name} merkitty lopetetuksi.`,
    "saveNotice.converted": ({ name }) => `${name} muutettu maksulliseksi.`,
    "saveNotice.trialAgain": ({ name }) => `${name} on taas kokeilu.`,
    "saveNotice.deleted": ({ name }) => `${name} poistettu.`,
    "saveNotice.reactivated": ({ name }) => `${name}: uusi kausi aloitettu.`,
  },
};
