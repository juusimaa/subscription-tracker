import { useEffect, useState } from "react";
import {
  createSubscription,
  deleteSubscription,
  getMonthlyTotal,
  getSubscriptions,
  updateSubscription,
} from "./api";
import "./App.css";

const emptyForm = {
  name: "",
  cost: "",
  billing_cycle: "monthly",
  next_renewal_date: "",
  category: "",
};

function App() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [monthlyTotal, setMonthlyTotal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    refresh();
  }, []);

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
    const payload = { ...form, cost: Number(form.cost) };
    try {
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
      <h1>Subscription Tracker</h1>

      {monthlyTotal !== null && (
        <div className="summary">
          Monthly total: <strong>{monthlyTotal}</strong>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <form className="subscription-form" onSubmit={handleSubmit}>
        <input
          placeholder="Name (e.g. Netflix)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
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
          {subscriptions.map((sub) => (
            <tr key={sub.id}>
              <td>{sub.name}</td>
              <td>{sub.cost}</td>
              <td>{sub.billing_cycle}</td>
              <td>{sub.next_renewal_date}</td>
              <td>{sub.category}</td>
              <td>
                <button onClick={() => startEdit(sub)}>Edit</button>
                <button onClick={() => handleDelete(sub.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
