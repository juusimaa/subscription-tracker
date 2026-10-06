// Messages shared across the app: the vocabulary every area uses (statuses,
// billing cycles, months), the formatting helpers in format.js and the API
// client's error lines. See src/i18n.js for the format.
//
// Finnish vocabulary, kept consistent everywhere:
//   subscription = tilaus            category = kategoria
//   charge (n.)  = veloitus          renewal = uusiutuminen
//   billing cycle = laskutusjakso    period (month/year shown) = ajanjakso
//   run (one stretch of a service, grouped runs) = kausi
//   trial = kokeilu                  active = aktiivinen
//   paused = tauolla                 cancelled = lopetettu
//   archived = arkistoitu            cancel a subscription = lopettaa
//   Cancel (dismiss a dialog) = Peruuta
//   reactivate / start a new run = aloittaa uusi kausi
//   export / import = vie / tuo      backup = varmuuskopio

const plural = (n, one, other) => (n === 1 ? one : other);

export default {
  en: {
    "language.label": "Language",

    "status.active": "Active",
    "status.trial": "Trial",
    "status.paused": "Paused",
    "status.cancelled": "Cancelled",
    "status.archived": "Archived",

    "cycle.monthly": "Monthly",
    "cycle.quarterly": "Quarterly",
    "cycle.yearly": "Yearly",
    "cycle.suffix.monthly": "/mo",
    "cycle.suffix.quarterly": "/qtr",
    "cycle.suffix.yearly": "/yr",

    "months.long": [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
    "months.short": [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ],

    "age.now": "just now",
    "age.underMinute": "less than a minute ago",
    "age.minutes": ({ n }) => `${n} ${plural(n, "minute", "minutes")} ago`,
    "age.hours": ({ n }) => `${n} ${plural(n, "hour", "hours")} ago`,
    "age.days": ({ n }) => `${n} ${plural(n, "day", "days")} ago`,

    "cost.required": "Required — enter what it charges.",
    "cost.notNumber": "Enter an amount like 9.99 or 9,99.",
    "cost.notPositive": "Must be greater than 0.",
    "cost.tooLarge": "Must be under €100,000,000.",

    "api.timeout": "The server took too long to answer.",
    "api.unreachable": "The server could not be reached.",
    "api.unreachableLogin": "The server could not be reached. Check your connection and try again.",
    "api.sessionExpired": "Your session expired.",
    "api.forbidden": "You don't have permission to do that.",
    "api.notFound": "That item no longer exists.",
    "api.conflict": "That clashes with something already saved.",
    "api.tooLarge": "That is too large to send.",
    "api.tooMany": "Too many requests in a short time.",
    "api.serverError": "The server ran into a problem.",
    "api.refused": "The server turned the request down.",
    "api.tryAgainSoon": "Try again in a moment.",
    "api.somethingWrong": "Something went wrong.",
    "api.nothingSaved": "Nothing was saved",
    "api.nothingChanged": "Nothing was changed",
    "api.checkConnection": ({ said, outcome }) => `${said} ${outcome} — check your connection and try again.`,
    "api.retryLater": ({ said, outcome }) => `${said} ${outcome} — try again in a moment.`,
    "api.plain": ({ said, outcome }) => `${said} ${outcome}.`,

    // The backend's details that are codes rather than English (see
    // serverMessage in api.js); everything else it says is shown as sent.
    "server.captcha": "The human check didn't go through. Try again.",
    "server.email_not_verified": "Confirm your email before you log in.",
  },

  fi: {
    "language.label": "Kieli",

    "status.active": "Aktiivinen",
    "status.trial": "Kokeilu",
    "status.paused": "Tauolla",
    "status.cancelled": "Lopetettu",
    "status.archived": "Arkistoitu",

    "cycle.monthly": "Kuukausittain",
    "cycle.quarterly": "Neljännesvuosittain",
    "cycle.yearly": "Vuosittain",
    "cycle.suffix.monthly": "/kk",
    "cycle.suffix.quarterly": "/nelj.",
    "cycle.suffix.yearly": "/v",

    // Nominative. The inessive ("syyskuussa", in September) is the
    // nominative plus "ssa" and the genitive ("syyskuun") plus "n", for every
    // month, so messages build those forms from these.
    "months.long": [
      "tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu",
      "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu",
    ],
    "months.short": [
      "tammi", "helmi", "maalis", "huhti", "touko", "kesä",
      "heinä", "elo", "syys", "loka", "marras", "joulu",
    ],

    "age.now": "juuri nyt",
    "age.underMinute": "alle minuutti sitten",
    "age.minutes": ({ n }) => `${n} ${plural(n, "minuutti", "minuuttia")} sitten`,
    "age.hours": ({ n }) => `${n} ${plural(n, "tunti", "tuntia")} sitten`,
    "age.days": ({ n }) => `${n} ${plural(n, "päivä", "päivää")} sitten`,

    "cost.required": "Pakollinen — kirjoita veloitettava summa.",
    "cost.notNumber": "Kirjoita summa muodossa 9,99 tai 9.99.",
    "cost.notPositive": "Summan on oltava suurempi kuin 0.",
    "cost.tooLarge": "Summan on oltava alle 100 000 000 €.",

    "api.timeout": "Palvelin ei vastannut ajoissa.",
    "api.unreachable": "Palvelimeen ei saatu yhteyttä.",
    "api.unreachableLogin": "Palvelimeen ei saatu yhteyttä. Tarkista yhteys ja yritä uudelleen.",
    "api.sessionExpired": "Istuntosi vanheni.",
    "api.forbidden": "Sinulla ei ole oikeutta tehdä tätä.",
    "api.notFound": "Kohdetta ei ole enää olemassa.",
    "api.conflict": "Tämä on ristiriidassa jo tallennetun tiedon kanssa.",
    "api.tooLarge": "Tämä on liian suuri lähetettäväksi.",
    "api.tooMany": "Liian monta pyyntöä lyhyessä ajassa.",
    "api.serverError": "Palvelimella tapahtui virhe.",
    "api.refused": "Palvelin hylkäsi pyynnön.",
    "api.tryAgainSoon": "Yritä hetken päästä uudelleen.",
    "api.somethingWrong": "Jokin meni vikaan.",
    "api.nothingSaved": "Mitään ei tallennettu",
    "api.nothingChanged": "Mitään ei muutettu",
    "api.checkConnection": ({ said, outcome }) => `${said} ${outcome} — tarkista yhteys ja yritä uudelleen.`,
    "api.retryLater": ({ said, outcome }) => `${said} ${outcome} — yritä hetken päästä uudelleen.`,
    "api.plain": ({ said, outcome }) => `${said} ${outcome}.`,

    // The backend's own error details, keyed by its exact English text (see
    // serverMessage in api.js). English needs entries only for the details
    // that are codes: one with no translation is shown as the server sent it.
    "server.Could not validate credentials": "Kirjautumista ei voitu vahvistaa.",
    "server.Database unavailable": "Tietokanta ei ole käytettävissä.",
    "server.captcha": "Ihmisyyden tarkistus ei mennyt läpi. Yritä uudelleen.",
    "server.email_not_verified": "Vahvista sähköpostiosoitteesi ennen kirjautumista.",
    "server.Incorrect email or password": "Sähköposti tai salasana on väärin.",
    "server.Incorrect password": "Salasana on väärin.",
    "server.Category already exists": "Kategoria on jo olemassa.",
    "server.Category not found": "Kategoriaa ei löytynyt.",
    "server.Subscription not found": "Tilausta ei löytynyt.",
    "server.A cancelled run cannot be reactivated in place; start a new run instead":
      "Lopetettua kautta ei voi aktivoida uudelleen; aloita sen sijaan uusi kausi.",
    "server.Only a cancelled subscription can be archived": "Vain lopetetun tilauksen voi arkistoida.",
    "server.Subscription is already archived": "Tilaus on jo arkistoitu.",
    "server.Subscription is not archived": "Tilausta ei ole arkistoitu.",
    "server.Only a cancelled subscription can be restored": "Vain lopetetun tilauksen voi palauttaa.",
    "server.This subscription already has a current run": "Tällä tilauksella on jo käynnissä oleva kausi.",
  },
};
