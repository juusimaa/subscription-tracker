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
// App.jsx listens for this. It does *not* blank the page: a session that
// lapses while the dashboard is on screen surfaces as a quiet strip under the
// header, because the figures are still worth reading and only writes will
// fail from here (STATES.md, "Session expired (401)").
const AUTH_EXPIRED = "auth-expired";
export const onAuthExpired = (handler) => {
  window.addEventListener(AUTH_EXPIRED, handler);
  // Returned so the caller's useEffect can unsubscribe on unmount.
  return () => window.removeEventListener(AUTH_EXPIRED, handler);
};

// Errors carry the status code and, where FastAPI sent one, a per-field map.
// Both matter to the UI rather than to the log: the design renders validation
// errors at the field that caused them and prints the status in the copy, so
// "the change wasn't saved" can say which code it was.
export class ApiError extends Error {
  constructor(message, status, fields = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        // The whole client side of JWT auth is this one header. No cookies
        // are involved, which is why the backend needs no CSRF or SameSite
        // setup.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...options,
    });
  } catch {
    // A network failure has no status at all. 0 stands in for "never reached
    // the server", which the banner reports the same way as a 5xx: something
    // the user cannot fix, with the last good data left on screen.
    throw new ApiError("The server could not be reached.", 0);
  }
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED));
    throw new ApiError("Your session expired.", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      formatError(body.detail) || `Request failed: ${res.status}`,
      res.status,
      fieldErrors(body.detail),
    );
  }
  // DELETE returns 204 No Content, so there's no JSON body to parse.
  if (res.status === 204) return null;
  return res.json();
}

// FastAPI returns a plain string for errors we raise ourselves, but a list of
// per-field objects for schema validation failures (a too-short password, a
// non-positive cost). This flattens both into one displayable string.
function formatError(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(", ");
  return null;
}

// The same list, keyed by field name so a message can be rendered at the
// input that caused it. `loc` is a path like ["body", "cost"]; the last
// element is the field, and anything without a body path (a whole-model
// validator, say) has no field to attach to and is left for the form-level
// line. This parsing is the client's job because nothing in the API names the
// field in a form a client can key on (TODO.md D5).
function fieldErrors(detail) {
  if (!Array.isArray(detail)) return {};
  const fields = {};
  for (const item of detail) {
    const loc = item.loc || [];
    const field = loc[loc.length - 1];
    if (typeof field === "string" && field !== "body") fields[field] = item.msg;
  }
  return fields;
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
  if (!res.ok) throw new ApiError(formatError(body.detail) || "Login failed", res.status);
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
// PUT rather than PATCH, and that is all the difference is: the route already
// has PATCH semantics via exclude_unset=True, so sending one field changes one
// field. The design's POST /:id/archive and /:id/restore are this same call
// with { status: "cancelled" } and { status: "active" } (TODO.md D7).
export const updateSubscription = (id, data) =>
  request(`/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteSubscription = (id) =>
  request(`/subscriptions/${id}`, { method: "DELETE" });

// What a period actually cost, month by month, with cancelled and paused
// plans counted up to the month they stopped. This is the route behind the
// headline total and the trend strip: the design asks for each month's real
// figure rather than today's basket scaled by a multiplier, and this is where
// the started/cancelled-aware arithmetic lives.
export function getSpend({ year, month, category } = {}) {
  const params = new URLSearchParams();
  if (year != null) params.set("year", String(year));
  if (month != null) params.set("month", String(month));
  if (category != null) params.set("category", category);
  const query = params.toString();
  return request(`/subscriptions/summary/spend${query ? `?${query}` : ""}`);
}

// Real money due in the next N days, each renewal listed on its own day.
// Feeds the "Charging in the next 30 days" figure, which is that question
// exactly -- not a share of the selected period.
export const getUpcoming = (days = 30) => request(`/subscriptions/upcoming?days=${days}`);

// --- Categories ---

export const getCategories = () => request("/categories");
export const createCategory = (name) =>
  request("/categories", { method: "POST", body: JSON.stringify({ name }) });
export const renameCategory = (id, name) =>
  request(`/categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
// A category still in use has to say what happens to those subscriptions, so
// the route refuses rather than quietly stripping the label off rows the
// caller may have forgotten about. The dialog only offers Delete when nothing
// live uses the category, so this is normally the plain form.
export const deleteCategory = (id, { detach = false } = {}) =>
  request(`/categories/${id}${detach ? "?detach=true" : ""}`, { method: "DELETE" });
