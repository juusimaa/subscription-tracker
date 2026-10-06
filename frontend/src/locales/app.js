// Messages for this area of the app; see src/i18n.js for the format.
//
// The app shell (nav, server banner, session strip, footer), the sign-in
// screen, the Account dialog and the backup file reader's error lines.

const plural = (n, one, other) => (n === 1 ? one : other);

export default {
  en: {
    "app.brand": "Subscriptions",
    "app.beta": "Beta",
    "app.navOverview": "Overview",
    "app.navAll": "All subscriptions",
    "app.accountLabel": ({ email }) => `Account — ${email}`,
    "app.logout": "Log out",
    "app.reauthLabel": "Sign in again",
    "app.bannerTitle": "Couldn't load your subscriptions",
    "app.bannerStale": ({ age }) => `Figures below were last updated ${age}.`,
    "app.bannerNothing": "Nothing has loaded yet.",
    "app.tryAgain": "Try again",
    "app.dismiss": "Dismiss",
    // The strip's sentence is split around its button.
    "app.sessionBefore": "Your session expired —",
    "app.sessionLink": "sign in again",
    "app.sessionAfter": "to keep editing. 401 from the server.",
    "app.github": "View on GitHub",

    "login.eyebrowExpired": "Session expired",
    "login.eyebrowRegister": "Create an account",
    "login.eyebrowWelcome": "Welcome back",
    "login.again": "Sign in again",
    "login.headline": "Subscriptions.",
    "login.email": "Email",
    "login.password": "Password",
    "login.invite": "Invite code",
    "login.signUp": "Sign up",
    "login.logIn": "Log in",
    "login.toLogin": "Already have an account? Log in",
    "login.toRegister": "Need an account? Sign up",
    "login.forgot": "Forgot your password?",
    "login.eyebrowForgot": "Forgotten password",
    "login.forgotNote": "Enter the email you signed up with. A link to choose a new password will be sent there.",
    "login.sendReset": "Send reset link",
    "login.resetSent": ({ email }) =>
      `If there's an account for ${email}, a reset link is on its way. It works once, for 1 hour. If nothing arrives, check your spam folder.`,
    "login.backToLogin": "Back to log in",
    "login.verified": ({ email }) => `${email} is confirmed. Log in to continue.`,
    "login.verifyExpired": "That confirmation link has expired. Log in to send yourself a new one.",
    "login.verifyInvalid": "That confirmation link doesn't work. Log in to send yourself a new one.",
    "login.resetExpired":
      "That reset link has expired or was already used. Each link works once, for 1 hour. Send yourself a new one below.",

    // Where a reset email's link lands (ResetPassword.jsx).
    "reset.eyebrow": "Reset password",
    "reset.headline": "New password.",
    "reset.note": "At least 8 characters. Setting it signs you out on every other device.",
    "reset.mismatch": "The two passwords don't match.",
    "reset.submit": "Set password and log in",
    "reset.done": "Password changed. Every other device has been signed out.",

    // The strip under the header about the account's email (EmailStrip.jsx).
    "verify.checking": "Checking your confirmation link…",
    "verify.nudge": ({ email }) =>
      `Confirm ${email} with the link we emailed you, so you can reset your password by email if you forget it.`,
    "verify.sendAgain": "Send the link again",
    "verify.sendNew": "Send a new one",
    "verify.sent": ({ email }) => `Sent. Check ${email}; the link works for 48 hours.`,
    "verify.nothingSent": "Nothing was sent.",
    "verify.done": ({ email }) => `${email} is confirmed.`,
    "verify.expired": "That confirmation link has expired.",
    "verify.invalid": "That confirmation link doesn't work.",

    "account.title": "Account",
    "account.close": "Close",
    "account.signedInAs": "Signed in as",
    "account.emailConfirmed": "Confirmed",
    "account.emailUnconfirmed": "Not confirmed yet.",
    "account.sendConfirm": "Send confirmation link",
    "account.confirmSent": "Sent. Check your inbox.",
    "account.languageNote": "Remembered on this device.",
    "account.changePassword": "Change password",
    "account.passwordNote":
      "At least 8 characters. Changing it signs you out on other devices — your subscriptions are untouched.",
    "account.currentPassword": "Current password",
    "account.newPassword": "New password",
    "account.repeatPassword": "Repeat new password",
    "account.needCurrent": "Enter your current password.",
    "account.mismatch": "The two new passwords don't match. 400 — nothing was changed.",
    "account.tooShort": "New password must be at least 8 characters.",
    "account.updatePassword": "Update password",
    "account.passwordDone": "Password updated — other devices signed out.",
    "account.deleteHeading": "Delete account",
    "account.deleteNote": ({ n }) =>
      `Removes your login and all ${n} subscription${plural(n, "", "s")}, including cancelled and archived ones, with their charge history. This cannot be undone — export your data first if you want a copy.`,
    "account.exportFirst": "Export first",
    "account.deleteMine": "Delete my account",
    "account.deleteTitle": ({ email }) => `Delete ${email}?`,
    "account.deleteBody": ({ subscriptions, categories }) =>
      `${subscriptions} subscription${plural(subscriptions, "", "s")}, ${categories} categor${plural(categories, "y", "ies")} and your login are removed. Everything goes at once and nothing can be restored afterwards.`,
    // The word to type is in the reader's own language, so the label, the
    // placeholder and the check all read this one key.
    "account.confirmWord": "DELETE",
    "account.confirmLabel": ({ word }) => `Type ${word} to confirm`,
    "account.deleteConfirm": "Delete account",
    "account.keep": "Keep my account",

    // `where` is one of the two location keys and is spliced into every row
    // message as its subject.
    "backup.whereRow": ({ row, file }) => `Row ${row} of ${file}`,
    "backup.wherePath": ({ index, file }) => `subscriptions[${index}] of ${file}`,
    "backup.dateShape": ({ where, field, text }) => `${where} has ${field} "${text}", which is not a YYYY-MM-DD date.`,
    "backup.dateReal": ({ where, field, text }) => `${where} has ${field} "${text}", which is not a real date.`,
    "backup.noName": ({ where }) => `${where} has no name.`,
    "backup.noCost": ({ where }) => `${where} has no cost.`,
    "backup.costNaN": ({ where, cost }) => `${where} has cost "${cost}", which is not a number.`,
    "backup.costPositive": ({ where, cost }) => `${where} has cost ${cost}; a cost has to be more than zero.`,
    "backup.badCycle": ({ where, value, allowed }) => `${where} has cycle "${value}". It has to be one of ${allowed}.`,
    "backup.badStatus": ({ where, value, allowed }) => `${where} has status "${value}". It has to be one of ${allowed}.`,
    "backup.noRenewal": ({ where }) => `${where} has no next_renewal date.`,
    "backup.others": ({ first, n }) => `${first} ${n} other row${plural(n, " has", "s have")} problems too.`,
    "backup.empty": ({ file }) => `${file} is empty.`,
    "backup.noColumns": ({ file }) => `${file} has no name and cost columns. The columns have to match the export.`,
    "backup.headerOnly": ({ file }) => `${file} has a header row and nothing else.`,
    "backup.badJson": ({ file, detail }) => `${file} is not valid JSON — ${detail}.`,
    "backup.notObject": ({ file }) => `${file} is not an export file: the top level is not an object.`,
    "backup.noList": ({ file }) => `${file} has no "subscriptions" list in it.`,
  },

  fi: {
    "app.brand": "Tilaukset",
    "app.beta": "Beta",
    "app.navOverview": "Yleiskatsaus",
    "app.navAll": "Kaikki tilaukset",
    "app.accountLabel": ({ email }) => `Tili — ${email}`,
    "app.logout": "Kirjaudu ulos",
    "app.reauthLabel": "Kirjaudu uudelleen",
    "app.bannerTitle": "Tilauksia ei voitu ladata",
    "app.bannerStale": ({ age }) => `Alla olevat luvut on päivitetty viimeksi ${age}.`,
    "app.bannerNothing": "Mitään ei ole vielä ladattu.",
    "app.tryAgain": "Yritä uudelleen",
    "app.dismiss": "Sulje",
    "app.sessionBefore": "Istuntosi vanheni —",
    "app.sessionLink": "kirjaudu uudelleen",
    "app.sessionAfter": "jatkaaksesi muokkaamista. Palvelin vastasi 401.",
    "app.github": "Näytä GitHubissa",

    "login.eyebrowExpired": "Istunto vanheni",
    "login.eyebrowRegister": "Luo tili",
    "login.eyebrowWelcome": "Tervetuloa takaisin",
    "login.again": "Kirjaudu uudelleen",
    "login.headline": "Tilaukset.",
    "login.email": "Sähköposti",
    "login.password": "Salasana",
    "login.invite": "Kutsukoodi",
    "login.signUp": "Luo tili",
    "login.logIn": "Kirjaudu sisään",
    "login.toLogin": "Onko sinulla jo tili? Kirjaudu sisään",
    "login.toRegister": "Eikö sinulla ole tiliä? Luo tili",
    "login.forgot": "Unohditko salasanasi?",
    "login.eyebrowForgot": "Unohtunut salasana",
    "login.forgotNote": "Anna sähköpostiosoite, jolla loit tilin. Sinne lähetetään linkki uuden salasanan valitsemiseen.",
    "login.sendReset": "Lähetä palautuslinkki",
    "login.resetSent": ({ email }) =>
      `Jos osoitteella ${email} on tili, palautuslinkki on matkalla. Linkki toimii kerran, tunnin ajan. Jos viestiä ei kuulu, katso roskapostikansio.`,
    "login.backToLogin": "Takaisin kirjautumiseen",
    "login.verified": ({ email }) => `${email} on vahvistettu. Kirjaudu sisään jatkaaksesi.`,
    "login.verifyExpired": "Vahvistuslinkki on vanhentunut. Kirjaudu sisään, niin voit lähettää itsellesi uuden.",
    "login.verifyInvalid": "Vahvistuslinkki ei toimi. Kirjaudu sisään, niin voit lähettää itsellesi uuden.",
    "login.resetExpired":
      "Palautuslinkki on vanhentunut tai jo käytetty. Jokainen linkki toimii kerran, tunnin ajan. Lähetä itsellesi uusi alla.",

    "reset.eyebrow": "Salasanan vaihto",
    "reset.headline": "Uusi salasana.",
    "reset.note": "Vähintään 8 merkkiä. Vaihto kirjaa sinut ulos kaikilla muilla laitteilla.",
    "reset.mismatch": "Salasanat eivät täsmää.",
    "reset.submit": "Vaihda salasana ja kirjaudu",
    "reset.done": "Salasana vaihdettu. Kaikki muut laitteet on kirjattu ulos.",

    "verify.checking": "Tarkistetaan vahvistuslinkkiä…",
    "verify.nudge": ({ email }) =>
      `Vahvista ${email} sähköpostiisi lähetetyllä linkillä, niin voit vaihtaa salasanan sähköpostitse, jos unohdat sen.`,
    "verify.sendAgain": "Lähetä linkki uudelleen",
    "verify.sendNew": "Lähetä uusi",
    "verify.sent": ({ email }) => `Lähetetty. Katso osoitteen ${email} saapuneet viestit; linkki toimii 48 tuntia.`,
    "verify.nothingSent": "Mitään ei lähetetty.",
    "verify.done": ({ email }) => `${email} on vahvistettu.`,
    "verify.expired": "Vahvistuslinkki on vanhentunut.",
    "verify.invalid": "Vahvistuslinkki ei toimi.",

    "account.title": "Tili",
    "account.close": "Sulje",
    "account.signedInAs": "Kirjautuneena",
    "account.emailConfirmed": "Vahvistettu",
    "account.emailUnconfirmed": "Ei vielä vahvistettu.",
    "account.sendConfirm": "Lähetä vahvistuslinkki",
    "account.confirmSent": "Lähetetty. Katso saapuneet viestit.",
    "account.languageNote": "Valinta muistetaan tällä laitteella.",
    "account.changePassword": "Vaihda salasana",
    "account.passwordNote":
      "Vähintään 8 merkkiä. Vaihtaminen kirjaa sinut ulos muilla laitteilla — tilauksesi pysyvät ennallaan.",
    "account.currentPassword": "Nykyinen salasana",
    "account.newPassword": "Uusi salasana",
    "account.repeatPassword": "Uusi salasana uudelleen",
    "account.needCurrent": "Kirjoita nykyinen salasanasi.",
    "account.mismatch": "Uudet salasanat eivät täsmää. 400 — mitään ei muutettu.",
    "account.tooShort": "Uuden salasanan on oltava vähintään 8 merkkiä pitkä.",
    "account.updatePassword": "Vaihda salasana",
    "account.passwordDone": "Salasana vaihdettu — muut laitteet kirjattu ulos.",
    "account.deleteHeading": "Poista tili",
    "account.deleteNote": ({ n }) =>
      n === 1
        ? "Poistaa käyttäjätunnuksesi ja ainoan tilauksesi veloitushistorioineen, myös jos se on lopetettu tai arkistoitu. Tätä ei voi perua — vie tietosi ensin, jos haluat niistä kopion."
        : `Poistaa käyttäjätunnuksesi ja kaikki ${n} tilaustasi veloitushistorioineen, myös lopetetut ja arkistoidut. Tätä ei voi perua — vie tietosi ensin, jos haluat niistä kopion.`,
    "account.exportFirst": "Vie tiedot ensin",
    "account.deleteMine": "Poista tilini",
    "account.deleteTitle": ({ email }) => `Poistetaanko ${email}?`,
    "account.deleteBody": ({ subscriptions, categories }) =>
      `${subscriptions} ${plural(subscriptions, "tilaus", "tilausta")}, ${categories} ${plural(categories, "kategoria", "kategoriaa")} ja käyttäjätunnuksesi poistetaan. Kaikki poistuu kerralla, eikä mitään voi palauttaa jälkikäteen.`,
    "account.confirmWord": "POISTA",
    "account.confirmLabel": ({ word }) => `Kirjoita ${word} vahvistaaksesi`,
    "account.deleteConfirm": "Poista tili",
    "account.keep": "Säilytä tilini",

    // Field names, the YYYY-MM-DD shape and the allowed values stay as the
    // file spells them: they are what the reader has to type into it.
    "backup.whereRow": ({ row, file }) => `Tiedoston ${file} rivillä ${row}`,
    "backup.wherePath": ({ index, file }) => `Tiedoston ${file} kohdassa subscriptions[${index}]`,
    "backup.dateShape": ({ where, field, text }) =>
      `${where} kentän ${field} arvo "${text}" ei ole päivämäärä muodossa YYYY-MM-DD.`,
    "backup.dateReal": ({ where, field, text }) =>
      `${where} kentän ${field} arvo "${text}" ei ole olemassa oleva päivämäärä.`,
    "backup.noName": ({ where }) => `${where} ei ole nimeä.`,
    "backup.noCost": ({ where }) => `${where} ei ole hintaa.`,
    "backup.costNaN": ({ where, cost }) => `${where} hinta on "${cost}", joka ei ole luku.`,
    "backup.costPositive": ({ where, cost }) => `${where} hinta on ${cost}; hinnan on oltava suurempi kuin nolla.`,
    "backup.badCycle": ({ where, value, allowed }) =>
      `${where} laskutusjakso on "${value}". Sen on oltava jokin näistä: ${allowed}.`,
    "backup.badStatus": ({ where, value, allowed }) =>
      `${where} tila on "${value}". Sen on oltava jokin näistä: ${allowed}.`,
    "backup.noRenewal": ({ where }) => `${where} ei ole next_renewal-päivämäärää.`,
    "backup.others": ({ first, n }) => `${first} Ongelmia on myös ${n} muulla rivillä.`,
    "backup.empty": ({ file }) => `Tiedosto ${file} on tyhjä.`,
    "backup.noColumns": ({ file }) =>
      `Tiedostossa ${file} ei ole name- ja cost-sarakkeita. Sarakkeiden on vastattava vientitiedostoa.`,
    "backup.headerOnly": ({ file }) => `Tiedostossa ${file} on otsikkorivi mutta ei mitään muuta.`,
    "backup.badJson": ({ file, detail }) => `Tiedosto ${file} ei ole kelvollista JSONia — ${detail}.`,
    "backup.notObject": ({ file }) => `Tiedosto ${file} ei ole vientitiedosto: sen ylin taso ei ole objekti.`,
    "backup.noList": ({ file }) => `Tiedostossa ${file} ei ole "subscriptions"-listaa.`,
  },
};
