// The add form, shared by the populated page and the empty state -- the
// design draws the same grid in both, differing only in vertical alignment,
// so it is one component with a variant rather than two.
//
// Validation happens here first (non-empty name, cost greater than zero) so a
// server rejection is the rare second line of defence. When one does come
// back its message is rendered at the field that caused it, or on the form
// line with what it means and what to do next (see describeWriteError).

import { useEffect, useId, useRef, useState } from "react";
import { ApiError, describeWriteError } from "../api";
import { TriangleAlert } from "../icons";
import { costProblem, cycleLabel, monthName, parseAmount, todayISO } from "../format";
import { CURRENCIES, inCurrency, userCurrency } from "../fx";
import { t } from "../i18n";
import { nextRenewalFrom } from "../renewals";

// The server's own limits (schemas.SubscriptionName), so a too-long name is
// stopped at the keyboard rather than coming back as a 422.
export const NAME_MAX = 100;

// A function rather than a constant so a tab left open past midnight starts
// its next subscription on the new day, not the one the page loaded on.
const blank = () => ({
  name: "",
  cost: "",
  // The user's own currency, which is what most of their plans bill in
  // (PLAN.md milestone 10). Reset to it after every save, like the cost.
  currency: userCurrency(),
  billing_cycle: "monthly",
  // Defaulted to today because that is what the API does with a missing start
  // date anyway (crud.create_subscription); showing it makes the assumption
  // visible and, more to the point, editable -- a plan you have had for two
  // years contributes nothing to the months before today until this is moved
  // back.
  started_date: todayISO(),
  // Worked out from the start date and cycle until it is typed into (see
  // withSuggestion), so it is never left on today for a plan someone has
  // had for years (issue #66).
  next_renewal_date: todayISO(),
  category: "",
  // Form-local only: it picks which labels the fields below show and which
  // status the submit turns into, but is never itself sent to the API.
  is_trial: false,
  // Form-local too: true once the renewal date has been set by hand, after
  // which nothing here overwrites it.
  renewal_edited: false,
});

// The form with its renewal date brought up to date with the start date and
// cycle, unless that date was typed in by hand. A paid plan gets the next
// charge on or after today; a trial gets nothing, because how long a trial
// lasts has nothing to do with the cycle it bills on afterwards, and a
// guessed end date is exactly the wrong total this is here to prevent.
function withSuggestion(form) {
  if (form.renewal_edited) return form;
  const suggested = form.is_trial
    ? ""
    : nextRenewalFrom(form.started_date, form.billing_cycle, todayISO()) || "";
  return { ...form, next_renewal_date: suggested };
}

// The month and year (zero-based month index) of a start date in the past,
// null otherwise -- the month the plan starts counting toward totals from.
// The message builds "September 2024" (or "syyskuusta 2024") from it.
function countsFrom(startedIso) {
  if (!startedIso || startedIso >= todayISO()) return null;
  const [y, m] = startedIso.split("-");
  return { month: Number(m) - 1, year: y };
}

// A function rather than a constant so the labels follow the language.
const planLabels = (trial) =>
  trial
    ? {
        cost: t("addForm.trial.cost"),
        started: t("addForm.trial.started"),
        renewal: t("addForm.trial.renewal"),
        submit: t("addForm.trial.submit"),
      }
    : {
        cost: t("addForm.paid.cost"),
        started: t("addForm.paid.started"),
        renewal: t("addForm.paid.renewal"),
        submit: t("addForm.paid.submit"),
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
  // The form appears twice on a page at most (inline and in the sheet), so
  // the cost label's htmlFor needs an id that is unique per instance.
  const idBase = useId();
  const [form, setFormRaw] = useState(() => withSuggestion(blank()));
  const setForm = (next) =>
    setFormRaw((current) => withSuggestion(typeof next === "function" ? next(current) : next));
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

  // ...and since a tile saves nothing, focus lands on the price it guessed,
  // selected, so the next keystroke corrects it and Enter adds it (issue
  // #63). Inside the mobile add sheet, useModal does the same through the
  // data-autofocus mark on the input, because the sheet focuses itself after
  // this effect has run.
  const costRef = useRef(null);
  useEffect(() => {
    if (!applied) return;
    costRef.current?.focus({ preventScroll: true });
    costRef.current?.select();
  }, [applied]);

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  // Any edit sticks, clearing included: a date input reports "" while a
  // segment is being retyped, and refilling the suggestion at that moment
  // would fight the keyboard. A cleared date is caught on submit instead.
  const setRenewal = (event) =>
    setForm({ ...form, next_renewal_date: event.target.value, renewal_edited: true });

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
    if (!form.name.trim()) found.name = t("addForm.nameRequired");
    const costError = costProblem(form.cost);
    if (costError) found.cost = costError;
    if (!form.next_renewal_date) {
      found.next_renewal_date = form.is_trial
        ? t("addForm.trialEndRequired")
        : t("addForm.renewalRequired");
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    // The values this save sends, kept so the reset below can tell them apart
    // from anything typed while it was in flight (issue #64).
    const submitted = form;
    setBusy(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        cost: parseAmount(form.cost),
        currency: form.currency,
        billing_cycle: form.billing_cycle,
        // Cleared means "not stated", which the API answers with today. Sent
        // as null rather than "": an empty string is a 422, not a default.
        started_date: form.started_date || null,
        next_renewal_date: form.next_renewal_date,
        // The API takes null for "no category"; an empty string would create
        // a category with a blank name.
        category: form.category || null,
        status: form.is_trial ? "trial" : "active",
      });
      // Only fields that still hold what was sent go back to blank: on a cold
      // start the save can take seconds, and the next subscription typed in
      // the meantime is not this one's to clear. Adding two trials in a row is
      // a real sequence, so the plan-type choice always survives the reset.
      // A renewal date that was only ever a suggestion is worked out again
      // from whatever the start date and cycle are now.
      const fresh = blank();
      setForm((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, value]) => [
            key,
            key === "is_trial" || value !== submitted[key] ? value : fresh[key],
          ]),
        ),
      );
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
        if (unfielded) setFormError(describeWriteError(err));
      } else {
        setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (key) => (errors[key] ? "field invalid" : "field");
  const foreign = form.currency !== userCurrency();
  const labels = planLabels(form.is_trial);
  const startMonth = countsFrom(form.started_date);
  // Only while the date is still the suggestion. A plan started today
  // charges today, which looks like a mistake unless it says so.
  const suggested = !form.is_trial && !form.renewal_edited && form.next_renewal_date;
  const renewalHint = !suggested
    ? null
    : form.next_renewal_date === form.started_date
      ? t("addForm.firstChargeHint")
      : startMonth
        ? t("addForm.workedOutHint")
        : null;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="plan-type-field">
        <span className="field-label">{t("addForm.planType")}</span>
        <div className="seg plan-type-seg" role="group" aria-label={t("addForm.planType")}>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={!form.is_trial}
            onClick={() => setForm({ ...form, is_trial: false })}
          >
            {t("addForm.paidPlan")}
          </button>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={form.is_trial}
            onClick={() => setForm({ ...form, is_trial: true })}
          >
            {t("addForm.freeTrial")}
          </button>
        </div>
        <p className="plan-type-hint">
          {form.is_trial
            ? t("addForm.trialHint")
            : t("addForm.paidHint")}
        </p>
      </div>

      <div className={`add-grid with-currency${endAligned ? " baseline" : ""}`}>
        <label className={field("name")}>
          <span className="field-label">{t("addForm.service")}</span>
          <input
            className="input"
            type="text"
            placeholder={t("addForm.servicePlaceholder")}
            maxLength={NAME_MAX}
            autoComplete="off"
            value={form.name}
            aria-invalid={errors.name ? "true" : undefined}
            onChange={set("name")}
          />
          {errors.name && (
            <span role="alert" className="field-error">{errors.name}</span>
          )}
          {!errors.name && duplicate && (
            <span className="field-warning">
              {t("addForm.duplicate", { name: duplicate.name })}{" "}
              <button type="button" className="link-button" onClick={() => onOpenExisting(duplicate)}>
                {t("addForm.editExisting")}
              </button>
              .
            </span>
          )}
        </label>

        {/* A div, not a label: the field holds two controls, the amount and
            its currency, joined into one (.money-field). The label names the
            amount; the select carries its own name. */}
        <div className={field("cost")}>
          <label className="field-label" htmlFor={`${idBase}-cost`}>{labels.cost}</label>
          <span className="money-field">
            {/* Text with a decimal keypad, not type="number": a number input
                hands back "" for "9,99" in most browsers, which would read as
                a missing cost to the one audience this app prices for. */}
            <input
              id={`${idBase}-cost`}
              ref={costRef}
              data-autofocus={prefill ? "" : undefined}
              className="input tnum"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("addForm.costPlaceholder")}
              value={form.cost}
              aria-invalid={errors.cost ? "true" : undefined}
              aria-describedby={foreign ? `${idBase}-cost-hint` : undefined}
              onChange={set("cost")}
            />
            <select
              className="input"
              aria-label={t("fx.currency")}
              value={form.currency}
              onChange={set("currency")}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </span>
          {errors.cost && <span role="alert" className="field-error">{errors.cost}</span>}
          {!errors.cost && foreign && (
            <span className="field-hint" id={`${idBase}-cost-hint`}>
              {t("fx.addHint", { shownIn: inCurrency() })}
            </span>
          )}
        </div>

        <label className="field">
          <span className="field-label">{t("addForm.cycle")}</span>
          <select className="input" value={form.billing_cycle} onChange={set("billing_cycle")}>
            <option value="monthly">{cycleLabel("monthly")}</option>
            <option value="quarterly">{cycleLabel("quarterly")}</option>
            <option value="yearly">{cycleLabel("yearly")}</option>
          </select>
        </label>

        {/* Before the renewal date, so the two read in the order they
            happen. No client-side rule about the future or the past: the API
            has none either, and a start date after the next renewal is how a
            plan booked ahead of time looks. */}
        <label className="field">
          <span className="field-label">{labels.started}</span>
          <input
            className="input tnum"
            type="date"
            value={form.started_date}
            onChange={set("started_date")}
          />
          {/* Only for a date in the past: that is when it changes the
              totals, and today's date needs no explaining. A trial counts
              from when it converts, not from here, so it gets no hint. */}
          {startMonth && !form.is_trial && (
            <span className="field-hint">{t("addForm.countsFrom", { month: monthName(startMonth.month), year: startMonth.year })}</span>
          )}
        </label>

        <label className={field("next_renewal_date")}>
          <span className="field-label">{labels.renewal}</span>
          <input
            className="input tnum"
            type="date"
            value={form.next_renewal_date}
            aria-invalid={errors.next_renewal_date ? "true" : undefined}
            onChange={setRenewal}
          />
          {errors.next_renewal_date && (
            <span role="alert" className="field-error">{errors.next_renewal_date}</span>
          )}
          {!errors.next_renewal_date && renewalHint && (
            <span className="field-hint">{renewalHint}</span>
          )}
        </label>

        <label className="field">
          <span className="field-label">{t("addForm.category")}</span>
          <select className="input" value={form.category} onChange={set("category")}>
            <option value="">{t("addForm.noCategory")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.name}>{category.name}</option>
            ))}
          </select>
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>{labels.submit}</button>
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
