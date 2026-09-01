// The gate in front of the whole app: one form that handles both signing in
// and creating an account, since the fields are identical either way.
//
// Also rendered inside a dialog when a session lapses mid-use (`compact`), so
// signing back in returns the user to the same period, sort and scroll
// position instead of a freshly mounted dashboard.

import { useState } from "react";
import { login, register } from "./api";
import { TriangleAlert } from "./icons";

function Login({ onLogin, email: knownEmail, compact = false }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState(knownEmail || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  // Disables the submit button while the request is in flight, so an
  // impatient double-click can't fire two registrations for the same email.
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Registering doesn't return a token, so a successful signup falls
      // straight through to login -- the user never has to type it twice.
      if (isRegistering) await register(email, password);
      const token = await login(email, password);
      // Handing the token up to App is what swaps this screen for the app.
      onLogin(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <>
      <span className="eyebrow">
        {compact ? "Session expired" : isRegistering ? "Create an account" : "Welcome back"}
      </span>
      {compact ? (
        <p className="dialog-title">Sign in again</p>
      ) : (
        <h1>Subscriptions.</h1>
      )}

      {error && (
        <p role="alert" className="login-error">
          <TriangleAlert />
          <span>{error}</span>
        </p>
      )}

      <form className="login-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            // Matches the backend's schema (schemas.UserCreate), so the
            // browser catches a too-short password before a round trip.
            minLength={8}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {isRegistering ? "Sign up" : "Log in"}
        </button>
      </form>

      {!compact && (
        <button
          type="button"
          className="link-button login-toggle"
          onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
        >
          {isRegistering ? "Already have an account? Log in" : "Need an account? Sign up"}
        </button>
      )}
    </>
  );

  return compact ? form : <div className="login">{form}</div>;
}

export default Login;
