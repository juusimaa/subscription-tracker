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

import { useState } from "react";
import { login, register, requestPasswordReset } from "./api";
import { t } from "./i18n";
import { LanguagePicker } from "./Language";
import { TriangleAlert } from "./icons";

function Login({ onLogin, email: knownEmail, compact = false, notice = null, initialMode = "login" }) {
  // "login", "register", "forgot", or "forgotSent" once a reset was requested.
  const [mode, setMode] = useState(initialMode);
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
  const [inviteCode, setInviteCode] = useState("");
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

  function switchTo(next) {
    setMode(next);
    setError(null);
    setInviteCode("");
    setHiddenNotice(notice);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        // The server answers the same whether or not the address has an
        // account, so this screen can't say which it was either.
        await requestPasswordReset(email);
        setMode("forgotSent");
        setHiddenNotice(notice);
        return;
      }
      // Registering doesn't return a token, so a successful signup falls
      // straight through to login -- the user never has to type it twice.
      if (isRegistering) await register(email, password, inviteCode);
      const token = await login(email, password);
      // Handing the token up to App is what swaps this screen for the app.
      onLogin(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = compact
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
          {isRegistering && (
            <label className="field">
              <span className="field-label">{t("login.invite")}</span>
              <input
                className="input"
                type="text"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                // Not every deployment requires one -- see the backend's
                // INVITE_CODE env var. Left blank, the request just omits it,
                // same as this app not having the field at all.
                autoComplete="off"
              />
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {isForgot ? t("login.sendReset") : isRegistering ? t("login.signUp") : t("login.logIn")}
          </button>
        </form>
      )}

      {!compact && (
        <button
          type="button"
          className="link-button login-toggle"
          onClick={() => switchTo(isForgot ? "login" : isRegistering ? "login" : "register")}
        >
          {isForgot ? t("login.backToLogin") : isRegistering ? t("login.toLogin") : t("login.toRegister")}
        </button>
      )}

      {!compact && <LanguagePicker className="login-language" />}
    </>
  );

  return compact ? form : <div className="login">{form}</div>;
}

export default Login;
