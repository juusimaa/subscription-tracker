// Thin wrapper around fetch() for talking to the FastAPI backend.

// import.meta.env.VITE_API_URL is injected by Vite at build/serve time from
// the VITE_API_URL environment variable (see docker-compose.yml). Only env
// vars prefixed with VITE_ are exposed to client-side code -- this prevents
// accidentally leaking server-only secrets into the browser bundle.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  // DELETE returns 204 No Content, so there's no JSON body to parse.
  if (res.status === 204) return null;
  return res.json();
}

export const getSubscriptions = () => request("/subscriptions");
export const getMonthlyTotal = () => request("/subscriptions/summary/monthly-total");
export const createSubscription = (data) =>
  request("/subscriptions", { method: "POST", body: JSON.stringify(data) });
export const updateSubscription = (id, data) =>
  request(`/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteSubscription = (id) =>
  request(`/subscriptions/${id}`, { method: "DELETE" });
