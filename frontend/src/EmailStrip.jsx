// One quiet line under the header about the account's email (PLAN.md
// milestone 9). It reports what an emailed link just did, and otherwise
// nudges an unconfirmed address.
//
// It reuses the session strip's chrome: secondary prose on the page ground,
// with a 2px rule under it. It never uses Signal Red, because an unconfirmed
// address is neither money nor a deadline (DESIGN.md, The One Signal Rule),
// and it never blocks anything, because an unconfirmed account works fine.
//
// Dismissing the nudge is remembered per browser and per address. The
// Account dialog keeps showing the status after that.

import { useState } from "react";
import { describeWriteError, resendVerification } from "./api";
import { t } from "./i18n";

const dismissKey = (email) => `verify-nudge-dismissed:${email}`;

function readDismissed(email) {
  try {
    return localStorage.getItem(dismissKey(email)) === "1";
  } catch {
    return false;
  }
}

// `message` is what a link just did: "verified", "verifyExpired",
// "verifyInvalid" or "resetDone".
function EmailStrip({ email, confirmedEmail, verified, message, onDismissMessage }) {
  const [nudgeDismissed, setNudgeDismissed] = useState(() => readDismissed(email));
  const [send, setSend] = useState({ state: "idle", error: null });

  // The nudge only shows when the server explicitly says "not confirmed".
  // A missing field (an older API) means there's nothing to nag about.
  const showNudge = !message && verified === false && !nudgeDismissed;
  if (!message && !showNudge) return null;

  async function sendLink() {
    setSend({ state: "sending", error: null });
    try {
      await resendVerification();
      setSend({ state: "sent", error: null });
    } catch (err) {
      setSend({ state: "error", error: describeWriteError(err, t("verify.nothingSent")) });
    }
  }

  function dismiss() {
    if (message) {
      onDismissMessage();
      return;
    }
    try {
      localStorage.setItem(dismissKey(email), "1");
    } catch {
      // Only the memory of the choice is lost; it still hides for now.
    }
    setNudgeDismissed(true);
  }

  // Re-sending is offered wherever the address is still unconfirmed.
  const canSend = verified === false && (showNudge || message === "verifyExpired" || message === "verifyInvalid");

  let text;
  if (message === "verified") text = t("verify.done", { email: confirmedEmail || email });
  else if (message === "verifyExpired") text = t("verify.expired");
  else if (message === "verifyInvalid") text = t("verify.invalid");
  else if (message === "resetDone") text = t("reset.done");
  else text = t("verify.nudge", { email });

  return (
    <div role="status" className="session-strip email-strip">
      <div className="email-strip-inner">
        <p>
          {send.state === "sent" ? t("verify.sent", { email }) : text}
          {canSend && send.state !== "sent" && (
            <>
              {" "}
              <button
                type="button"
                className="link-button"
                disabled={send.state === "sending"}
                onClick={sendLink}
              >
                {message ? t("verify.sendNew") : t("verify.sendAgain")}
              </button>
            </>
          )}
          {send.error && <span className="email-strip-error"> {send.error}</span>}
        </p>
        <button type="button" className="link-button email-strip-dismiss" onClick={dismiss}>
          {t("app.dismiss")}
        </button>
      </div>
    </div>
  );
}

export default EmailStrip;
