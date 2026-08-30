// Single-page UI for the subscription tracker: a form for adding/editing,
// a table of existing subscriptions, and the monthly-total summary. Kept as
// one component since the app is small; a larger app would split this into
// separate components (Form, Table, Summary) with the state lifted up.
//
// Everything here renders only for a logged-in user -- see the token gate
// below, which shows <Login> instead when there's no valid session.

import { useEffect, useState } from "react";
import {
  createSubscription,
  deleteSubscription,
  getMe,
  getMonthlyTotal,
  getSubscriptions,
  getToken,
  logout,
  onAuthExpired,
  updateSubscription,
} from "./api";
import Login from "./Login";
import ServicePicker from "./ServicePicker";
import { findService } from "./services";
import ServiceIcon from "./ServiceIcon";
import "./App.css";

// Shared shape for a blank form and for resetting after submit/cancel.
const emptyForm = {
  name: "",
  cost: "",
  billing_cycle: "monthly",
  next_renewal_date: "",
  category: "",
};

function App() {
  // Initialised straight from localStorage so a returning user with an
  // unexpired token skips the login screen entirely. The lazy function form
  // means localStorage is read once on mount, not on every render.
  const [token, setToken] = useState(() => getToken());
  const [email, setEmail] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [monthlyTotal, setMonthlyTotal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  // null when adding a new subscription; set to a subscription's id while editing.
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  // Re-fetches both the list and the summary together, so the UI never
  // shows a total that's out of sync with the visible rows.
  async function refresh() {
    try {
      const [subs, total] = await Promise.all([getSubscriptions(), getMonthlyTotal()]);
      setSubscriptions(subs);
      setMonthlyTotal(total.monthly_total);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  // Runs on mount and again after each login. A token found in localStorage
  // may well be expired, so /me is called first: if the backend rejects it,
  // api.js clears the token and fires auth-expired, and the effect below
  // drops us back to the login screen instead of showing an empty app.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const me = await getMe();
        setEmail(me.email);
        await refresh();
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [token]);

  // Any 401 from any request means the session is over -- clear the local
  // state so the gate below re-renders as <Login>.
  useEffect(() => {
    return onAuthExpired(() => {
      setToken(null);
      setEmail(null);
    });
  }, []);

  function handleLogout() {
    logout();
    setToken(null);
    setEmail(null);
    // Drop the previous user's data so it can't flash on screen if someone
    // else logs in on the same browser.
    setSubscriptions([]);
    setMonthlyTotal(null);
    setError(null);
  }

  // The gate: no token, no app. Everything below this line is unreachable
  // until onLogin hands back a token.
  if (!token) {
    return <Login onLogin={setToken} />;
  }

  function startEdit(sub) {
    setEditingId(sub.id);
    setForm({
      name: sub.name,
      cost: sub.cost,
      billing_cycle: sub.billing_cycle,
      next_renewal_date: sub.next_renewal_date,
      category: sub.category || "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Form inputs are always strings; the API expects cost as a number.
    const payload = { ...form, cost: Number(form.cost) };
    try {
      // Same form/submit handler for both add and edit -- editingId decides
      // which API call to make.
      if (editingId) {
        await updateSubscription(editingId, payload);
      } else {
        await createSubscription(payload);
      }
      cancelEdit();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteSubscription(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Subscription Tracker</h1>
        <div className="account">
          {email && <span className="account-email">{email}</span>}
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {monthlyTotal !== null && (
        <div className="summary">
          Monthly total: <strong>{monthlyTotal}</strong>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <form className="subscription-form" onSubmit={handleSubmit}>
        <ServicePicker
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
          // Picking a known service fills in its price as well as its name.
          // billing_cycle is forced back to monthly because the catalogue
          // price is a monthly one -- leaving the form on "Yearly" would
          // otherwise record Netflix as costing 13.99 a *year*.
          onPickService={(service) =>
            setForm({
              ...form,
              name: service.name,
              cost: service.monthlyCost,
              billing_cycle: "monthly",
            })
          }
        />
        <input
          type="number"
          step="0.01"
          placeholder="Cost"
          value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })}
          required
        />
        <select
          value={form.billing_cycle}
          onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <input
          type="date"
          value={form.next_renewal_date}
          onChange={(e) => setForm({ ...form, next_renewal_date: e.target.value })}
          required
        />
        <input
          placeholder="Category (optional)"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <button type="submit">{editingId ? "Update" : "Add"}</button>
        {editingId && (
          <button type="button" onClick={cancelEdit}>
            Cancel
          </button>
        )}
      </form>

      <table className="subscription-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Cost</th>
            <th>Cycle</th>
            <th>Next renewal</th>
            <th>Category</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((sub) => {
            // undefined for anything typed by hand rather than picked from
            // the catalogue, which then just renders as a bare name.
            const service = findService(sub.name);
            return (
              <tr key={sub.id}>
                <td>
                  <span className="subscription-name">
                    {service && <ServiceIcon service={service} />}
                    {sub.name}
                  </span>
                </td>
                <td>{sub.cost}</td>
                <td>{sub.billing_cycle}</td>
                <td>{sub.next_renewal_date}</td>
                <td>{sub.category}</td>
                <td>
                  <button onClick={() => startEdit(sub)}>Edit</button>
                  <button onClick={() => handleDelete(sub.id)}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
