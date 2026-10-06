// The gate in front of the whole app: one form that handles both signing in
// and creating an account, since the fields are identical either way, plus
// the "forgot password" request that hangs off it (PLAN.md milestone 9).
//
// Also rendered inside a dialog when a session lapses mid-use (`compact`), so
// signing back in returns the user to the same period, sort and scroll
// position instead of a freshly mounted dashboard.
//
// `notice` is a plain status line above the form for what an emailed link
// just did ("x is confirmed", "that link has expired"). It is not an error:
// nothing the user typed went wrong.
//
// An account can't sign in until its address is confirmed. Signing up, and a
// sign-in the backend refuses for that reason, both end on the same "check
// your inbox" screen, which can send the link again.

import { useState } from "react";
import { ApiError, describeWriteError, login, register, requestPasswordReset, resendVerification } from "./api";
import { t } from "./i18n";
import { LanguagePicker } from "./Language";
import { TriangleAlert } from "./icons";
import Turnstile from "./Turnstile";
import { TURNSTILE_SITE_KEY } from "./turnstileKey";

function Login({ onLogin, email: knownEmail, compact = false, notice = null, initialMode = "login" }) {
  // "login", "register", "forgot", "forgotSent" once a reset was requested,
  // or "checkInbox" once a confirmation link is what stands in the way.
  const [mode, setMode] = useState(initialMode);
  // Why "checkInbox" is showing: "registered" or "unconfirmed" (a sign-in
  // the backend refused until the address is confirmed).
  const [inboxReason, setInboxReason] = useState(null);
  const [resend, setResend] = useState({ state: "idle", error: null });
  const [email, setEmail] = useState(knownEmail || "");
  // A confirmation link names its address only once the check comes back,
  // after this screen is already up. Fill it in then, unless the user has
  // started typing one of their own.
  const [lastKnown, setLastKnown] = useState(knownEmail);
  if (knownEmail !== lastKnown) {
    setLastKnown(knownEmail);
    if (knownEmail && !email) setEmail(knownEmail);
  }
  const [password, setPassword] = useState("");
  // The bot check's token, and a counter that remounts the widget for a
  // fresh one after each attempt -- a token is good for one check only.
  const [captcha, setCaptcha] = useState(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [error, setError] = useState(null);
  // Disables the submit button while the request is in flight, so an
  // impatient double-click can't fire two registrations for the same email.
  const [busy, setBusy] = useState(false);
  // A notice shows until the user moves to another form, so it does not
  // linger over a screen it no longer describes. Remembering *which* notice
  // was put away lets a newer one (the link check finishing) still show.
  const [hiddenNotice, setHiddenNotice] = useState(null);
  const showNotice = Boolean(notice) && notice !== hiddenNotice;

  const isRegistering = mode === "register";
  const isForgot = mode === "forgot" || mode === "forgotSent";
  // Only the two forms that make the backend email an unproven address.
  const needsCaptcha = Boolean(TURNSTILE_SITE_KEY) && (isRegistering || mode === "forgot");

  function switchTo(next) {
    setMode(next);
    setError(null);
    setCaptcha(null);
    setResend({ state: "idle", error: null });
    setHiddenNotice(notice);
  }

  function showInbox(reason) {
    setInboxReason(reason);
    setResend({ state: "idle", error: null });
    setMode("checkInbox");
    setHiddenNotice(notice);
  }

  async function sendLinkAgain() {
    setResend({ state: "sending", error: null });
    try {
      await resendVerification(email, password);
      setResend({ state: "sent", error: null });
    } catch (err) {
      setResend({ state: "error", error: describeWriteError(err, t("verify.nothingSent")) });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        // The server answers the same whether or not the address has an
        // account, so this screen can't say which it was either.
        await requestPasswordReset(email, captcha);
        setMode("forgotSent");
        setHiddenNotice(notice);
        return;
      }
      if (isRegistering) {
        // Same answer for a taken address as a new one; the email says
        // which. Either way there is nothing to sign in to until a link in
        // it has been opened.
        await register(email, password, captcha);
        showInbox("registered");
        return;
      }
      const token = await login(email, password);
      // Handing the token up to App is what swaps this screen for the app.
      onLogin(token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && mode === "login") {
        showInbox("unconfirmed");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
      setCaptcha(null);
      setCaptchaRound((round) => round + 1);
    }
  }

  const eyebrow = mode === "checkInbox"
    ? t("login.eyebrowInbox")
    : compact
    ? t("login.eyebrowExpired")
    : isForgot
      ? t("login.eyebrowForgot")
      : isRegistering
        ? t("login.eyebrowRegister")
        : t("login.eyebrowWelcome");

  const form = (
    <>
      <span className="eyebrow">{eyebrow}</span>
      {compact ? (
        <p className="dialog-title">{t("login.again")}</p>
      ) : (
        <h1>{t("login.headline")}</h1>
      )}

      {showNotice && (
        <p role="status" className="login-notice">{notice}</p>
      )}

      {error && (
        <p role="alert" className="login-error">
          <TriangleAlert />
          <span>{error}</span>
        </p>
      )}

      {mode === "forgotSent" ? (
        <p role="status" className="login-sent">{t("login.resetSent", { email })}</p>
      ) : mode === "checkInbox" ? (
        <div role="status" className="login-sent">
          <p>
            {resend.state === "sent"
              ? t("verify.sent", { email })
              : inboxReason === "registered"
                ? t("login.checkInbox", { email })
                : t("login.confirmFirst", { email })}
          </p>
          {resend.state !== "sent" && (
            <p>
              <button
                type="button"
                className="link-button"
                disabled={resend.state === "sending"}
                onClick={sendLinkAgain}
              >
                {t("verify.sendAgain")}
              </button>
              {resend.error && <span className="login-resend-error"> {resend.error}</span>}
            </p>
          )}
        </div>
      ) : (
        <form className="login-form" onSubmit={handleSubmit}>
          {isForgot && <p className="login-explainer">{t("login.forgotNote")}</p>}
          <label className="field">
            <span className="field-label">{t("login.email")}</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {!isForgot && (
            <div>
              <label className="field">
                <span className="field-label">{t("login.password")}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete={isRegistering ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  // Matches the backend's schema (schemas.UserCreate), so the
                  // browser catches a too-short password before a round trip.
                  minLength={8}
                  required
                />
              </label>
              {mode === "login" && !compact && (
                <button
                  type="button"
                  className="link-button login-forgot"
                  onClick={() => switchTo("forgot")}
                >
                  {t("login.forgot")}
                </button>
              )}
            </div>
          )}
          {needsCaptcha && (
            <Turnstile
              key={captchaRound}
              action={isRegistering ? "signup" : "password_reset"}
              onToken={setCaptcha}
            />
          )}
          <button
            type="submit"
            className="btn btn-primary"
            // Held until the bot check has a token, rather than sending a
            // request the backend is certain to refuse.
            disabled={busy || (needsCaptcha && !captcha)}
          >
            {isForgot ? t("login.sendReset") : isRegistering ? t("login.signUp") : t("login.logIn")}
          </button>
        </form>
      )}

      {(!compact || mode === "checkInbox") && (
        <button
          type="button"
          className="link-button login-toggle"
          onClick={() => switchTo(mode === "login" ? "register" : "login")}
        >
          {isForgot || mode === "checkInbox"
            ? t("login.backToLogin")
            : isRegistering
              ? t("login.toLogin")
              : t("login.toRegister")}
        </button>
      )}

      {!compact && <LanguagePicker className="login-language" />}
    </>
  );

  return compact ? form : <div className="login">{form}</div>;
}

export default Login;
