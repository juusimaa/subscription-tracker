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
