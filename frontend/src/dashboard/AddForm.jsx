// The add form, shared by the populated page and the empty state -- the
// design draws the same grid in both, differing only in vertical alignment,
// so it is one component with a variant rather than two.
//
// Validation happens here first (non-empty name, cost greater than zero) so a
// server rejection is the rare second line of defence. When one does come
// back its message is rendered at the field that caused it, with the status
// code in the copy, because that is what support triages from a screenshot.

import { useState } from "react";
import { ApiError } from "../api";
import { TriangleAlert } from "../icons";
import { todayISO } from "../format";

const blank = {
  name: "",
  cost: "",
  billing_cycle: "monthly",
  // Defaulted to today because that is what the API does with a missing start
  // date anyway (crud.create_subscription); showing it makes the assumption
  // visible and, more to the point, editable -- a plan you have had for two
  // years contributes nothing to the months before today until this is moved
  // back.
  started_date: todayISO(),
  next_renewal_date: todayISO(),
  category: "",
};

function AddForm({
  categories,
  existing = [],
  onSubmit,
  onOpenExisting,
  prefill,
  endAligned = false,
  // Called after a successful submit, with nothing to pass -- the desktop
  // inline form ignores it (the row just appears further down the page); the
  // mobile add sheet uses it to close itself, which a modal has to do and an
  // inline form does not.
  onSuccess,
}) {
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  // A quick-add tile pre-fills the form; it does not save silently. Compared
  // by identity, so the same tile tapped twice re-applies, and a re-render
  // never clobbers what has been typed since.
  const [applied, setApplied] = useState(null);
  if (prefill && prefill !== applied) {
    setApplied(prefill);
    setForm({ ...form, ...prefill });
  }

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  // A warning, never a refusal. Two Netflix accounts in one household are an
  // ordinary thing to track, so uniqueness is not a rule the API enforces and
  // not one this form should invent (TODO.md D4). It is still worth saying:
  // "you already track Netflix" is useful right up until it becomes a block.
  const duplicate = existing.find(
    (subscription) => subscription.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
  );

  async function handleSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!form.name.trim()) found.name = "Required — pick a service or type a name.";
    if (!(Number(form.cost) > 0)) found.cost = "Must be greater than 0.";
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        cost: Number(form.cost),
        billing_cycle: form.billing_cycle,
        // Cleared means "not stated", which the API answers with today. Sent
        // as null rather than "": an empty string is a 422, not a default.
        started_date: form.started_date || null,
        next_renewal_date: form.next_renewal_date,
        // The API takes null for "no category"; an empty string would create
        // a category with a blank name.
        category: form.category || null,
      });
      setForm(blank);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({
          name: err.fields.name,
          cost: err.fields.cost,
        });
        // Anything the server could not pin to a field lands on the
        // form-level line. Note this is where the design puts "Renewal date
        // must be in the future" -- a rule this API deliberately does not
        // have, because next_renewal_date is an anchor and a date years in
        // the past is valid and often correct (TODO.md D5). The slot renders
        // what the server actually said instead of asserting a rule nobody
        // implemented.
        const unfielded = !err.fields.name && !err.fields.cost;
        if (unfielded) setFormError(`${err.message} ${err.status} — nothing was saved.`);
      } else {
        setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (key) => (errors[key] ? "field invalid" : "field");

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={endAligned ? "add-grid baseline" : "add-grid"}>
        <label className={field("name")}>
          <span className="field-label">Service</span>
          <input
            className="input"
            type="text"
            placeholder="Netflix, Spotify, …"
            value={form.name}
            aria-invalid={errors.name ? "true" : undefined}
            onChange={set("name")}
          />
          {errors.name && (
            <span role="alert" className="field-error">{errors.name}</span>
          )}
          {!errors.name && duplicate && (
            <span className="field-warning">
              You already track {duplicate.name}.{" "}
              <button type="button" className="link-button" onClick={() => onOpenExisting(duplicate)}>
                Edit that subscription instead
              </button>
              .
            </span>
          )}
        </label>

        <label className={field("cost")}>
          <span className="field-label">Cost</span>
          <input
            className="input tnum"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form.cost}
            aria-invalid={errors.cost ? "true" : undefined}
            onChange={set("cost")}
          />
          {errors.cost && <span role="alert" className="field-error">{errors.cost}</span>}
        </label>

        <label className="field">
          <span className="field-label">Cycle</span>
          <select className="input" value={form.billing_cycle} onChange={set("billing_cycle")}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>

        {/* Before the renewal date, so the two read in the order they
            happen. No client-side rule about the future or the past: the API
            has none either, and a start date after the next renewal is how a
            plan booked ahead of time looks. */}
        <label className="field">
          <span className="field-label">Started</span>
          <input
            className="input tnum"
            type="date"
            value={form.started_date}
            onChange={set("started_date")}
          />
        </label>

        <label className="field">
          <span className="field-label">Next renewal</span>
          <input
            className="input tnum"
            type="date"
            value={form.next_renewal_date}
            onChange={set("next_renewal_date")}
          />
        </label>

        <label className="field">
          <span className="field-label">Category</span>
          <select className="input" value={form.category} onChange={set("category")}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.name}>{category.name}</option>
            ))}
          </select>
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
      </div>

      {formError && (
        <p role="alert" className="form-error">
          <TriangleAlert />
          <span>{formError}</span>
        </p>
      )}
    </form>
  );
}

export default AddForm;
