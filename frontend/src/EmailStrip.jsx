// One quiet line under the header about what an emailed link just did
// (PLAN.md milestone 9): an address confirmed, a link that had expired or
// didn't work, a password reset.
//
// There is no nudge for an unconfirmed address any more: an account can't
// sign in until its address is confirmed, so a signed-in one always is.
//
// It reuses the session strip's chrome: secondary prose on the page ground,
// with a 2px rule under it. It never uses Signal Red, because none of this is
// money or a deadline (DESIGN.md, The One Signal Rule).

import { t } from "./i18n";

// `message` is what a link just did: "verified", "verifyExpired",
// "verifyInvalid" or "resetDone".
function EmailStrip({ email, confirmedEmail, message, onDismissMessage }) {
  if (!message) return null;

  let text;
  // A link opens in whichever browser the mail app picks, which may be
  // signed in as someone else; then say whose address it was and how to get
  // to it, so it doesn't read as news about the signed-in account.
  if (message === "verified" && confirmedEmail && confirmedEmail.toLowerCase() !== email.toLowerCase()) {
    text = t("verify.doneOther", { email: confirmedEmail, current: email });
  } else if (message === "verified") text = t("verify.done", { email: confirmedEmail || email });
  else if (message === "verifyExpired") text = t("verify.expired");
  else if (message === "verifyInvalid") text = t("verify.invalid");
  else text = t("reset.done");

  return (
    <div role="status" className="session-strip email-strip">
      <div className="email-strip-inner">
        <p>{text}</p>
        <button type="button" className="link-button email-strip-dismiss" onClick={onDismissMessage}>
          {t("app.dismiss")}
        </button>
      </div>
    </div>
  );
}

export default EmailStrip;
