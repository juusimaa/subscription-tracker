// The gate in front of the whole app: one form that handles both signing in
// and creating an account, since the fields are identical either way.

import { useState } from "react";
import { login, register } from "./api";

function Login({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  // Disables the submit button while the request is in flight, so an
  // impatient double-click can't fire two registrations for the same email.
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
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

  return (
    <div className="app login">
      <h1>Subscription Tracker</h1>
      <h2>{isRegistering ? "Create an account" : "Log in"}</h2>

      {error && <div className="error">{error}</div>}

      <form className="login-form" onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // Matches the backend's schema (schemas.UserCreate), so the browser
          // catches a too-short password before a round trip.
          minLength={8}
          required
        />
        <button type="submit" disabled={busy}>
          {isRegistering ? "Sign up" : "Log in"}
        </button>
      </form>

      <button
        type="button"
        className="link-button"
        onClick={() => {
          setIsRegistering(!isRegistering);
          setError(null);
        }}
      >
        {isRegistering ? "Already have an account? Log in" : "Need an account? Sign up"}
      </button>
    </div>
  );
}

export default Login;
