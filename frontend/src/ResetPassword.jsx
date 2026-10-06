// Where a password-reset email's link lands (?reset=TOKEN, see linkParams.js).
// The same flush-left shell as the sign-in screen, so it reads as the same
// product: one new password, typed twice, then straight into the app.
//
// A link the server turns down (expired, or already used -- each one works
// once) is not a dead end: App sends the user back to the "forgot password"
// form with a line saying what happened, so a fresh link is one click away.

import { useState } from "react";
import { confirmPasswordReset, describeWriteError, linkProblem } from "./api";
import { t } from "./i18n";
import { LanguagePicker } from "./Language";
import { TriangleAlert } from "./icons";

function ResetPassword({ token, onDone, onExpired, onCancel }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password !== repeat) {
      setError(t("reset.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await confirmPasswordReset(token, password));
    } catch (err) {
      if (linkProblem(err)) {
        onExpired();
        return;
      }
      setError(describeWriteError(err, t("api.nothingChanged")));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <span className="eyebrow">{t("reset.eyebrow")}</span>
      <h1>{t("reset.headline")}</h1>

      {error && (
        <p role="alert" className="login-error">
          <TriangleAlert />
          <span>{error}</span>
        </p>
      )}

      <form className="login-form" onSubmit={handleSubmit}>
        <p className="login-explainer">{t("reset.note")}</p>
        <label className="field">
          <span className="field-label">{t("account.newPassword")}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{t("account.repeatPassword")}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            minLength={8}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("reset.submit")}
        </button>
      </form>

      <button type="button" className="link-button login-toggle" onClick={onCancel}>
        {t("login.backToLogin")}
      </button>

      <LanguagePicker className="login-language" />
    </div>
  );
}

export default ResetPassword;
