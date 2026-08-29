// Thin wrapper around fetch() for talking to the FastAPI backend.

// import.meta.env.VITE_API_URL is injected by Vite at build/serve time from
// the VITE_API_URL environment variable (see docker-compose.yml). Only env
// vars prefixed with VITE_ are exposed to client-side code -- this prevents
// accidentally leaking server-only secrets into the browser bundle. It is
// also why the JWT signing key is never a VITE_ variable: anything prefixed
// that way is readable by anyone who opens the page.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOKEN_KEY = "token";

// localStorage is scoped to this origin and this browser profile: the token
// survives a page reload and a browser restart, but a different browser,
// device, or private window starts with nothing and lands on the login form.
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Fired when the backend rejects our token (expired, or the account is gone).
// App.jsx listens for this and drops back to the login screen, so a stale
// session never surfaces as a bare "Request failed: 401" over an empty table.
const AUTH_EXPIRED = "auth-expired";
export const onAuthExpired = (handler) => {
  window.addEventListener(AUTH_EXPIRED, handler);
  // Returned so the caller's useEffect can unsubscribe on unmount.
  return () => window.removeEventListener(AUTH_EXPIRED, handler);
};

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      // The whole client side of JWT auth is this one header. No cookies are
      // involved, which is why the backend needs no CSRF or SameSite setup.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED));
    throw new Error("Your session has expired. Please log in again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(formatError(body.detail) || `Request failed: ${res.status}`);
  }
  // DELETE returns 204 No Content, so there's no JSON body to parse.
  if (res.status === 204) return null;
  return res.json();
}

// FastAPI returns a plain string for errors we raise ourselves, but a list of
// per-field objects for schema validation failures (a too-short password, a
// malformed email). This flattens both into one displayable string.
function formatError(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(", ");
  return null;
}

// --- Auth ---

export async function login(email, password) {
  // /token follows the OAuth2 password flow, which specifies a form-encoded
  // body with fields literally named "username" and "password" -- not JSON.
  // Our email goes in the "username" field.
  const res = await fetch(`${API_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatError(body.detail) || "Login failed");
  setToken(body.access_token);
  return body.access_token;
}

export const register = (email, password) =>
  request("/register", { method: "POST", body: JSON.stringify({ email, password }) });

export const getMe = () => request("/me");

export function logout() {
  // Purely client-side: the token stays technically valid until it expires,
  // there just isn't a copy of it anywhere anymore. Server-side revocation
  // would need a token blocklist, which is out of scope here.
  clearToken();
}

// --- Subscriptions ---

export const getSubscriptions = () => request("/subscriptions");
export const getMonthlyTotal = () => request("/subscriptions/summary/monthly-total");
export const createSubscription = (data) =>
  request("/subscriptions", { method: "POST", body: JSON.stringify(data) });
export const updateSubscription = (id, data) =>
  request(`/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteSubscription = (id) =>
  request(`/subscriptions/${id}`, { method: "DELETE" });
