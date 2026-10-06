// The dashboard proper: one screen, one selected period, everything on it
// derived from that selection.
//
// Nothing here fetches. App.jsx owns the data and the error states; this
// component owns the view state (which period, which sort, which row is being
// edited, which dialog is open) and the arithmetic that turns the API's
// answers into the figures the design asks for.

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, describeWriteError } from "../api";
import {
  approxText,
  MAX_YEAR,
  MIN_YEAR,
  longDate,
  money,
  monthName,
  shortMonthName,
  signed,
  toISO,
  todayISO,
} from "../format";
import { comparable, convert, inCurrency, isForeign } from "../fx";
import { t } from "../i18n";
import { chargeCountInYear, chargesInMonth } from "../renewals";
import { useIsMobile } from "../useMediaQuery";
import { readListView, writeView } from "../viewUrl";
import AddForm from "./AddForm";
import CategoriesDialog from "./CategoriesDialog";
import CategoryBars from "./CategoryBars";
import ComingUp from "./ComingUp";
import CancelDialog from "./CancelDialog";
import ConfirmDialog from "./ConfirmDialog";
import EmptyState from "./EmptyState";
import Hero from "./Hero";
import ImportExport from "./ImportExport";
import ListGuide from "./ListGuide";
import KpiBand from "./KpiBand";
import NextCharge from "./NextCharge";
import ReactivateDialog from "./ReactivateDialog";
import SaveNotice from "./SaveNotice";
import SectionToggle from "./SectionToggle";
import Sheet from "./Sheet";
import SubscriptionTable from "./SubscriptionTable";
import TrendStrip from "./TrendStrip";
import TrialBanner from "./TrialBanner";
import { accessEnded, buildGroups } from "./groups";

function Dashboard({
  subscriptions,
  categories,
  spendByYear,
  spendByCategory,
  upcomingTotal,
  // Whether the 30-day figure converted anything (PLAN.md milestone 10).
  upcomingApprox = false,
  period,
  setPeriod,
  actions,
  staleId,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Sort and the two toggles open as the URL left them (see viewUrl.js);
  // read once, on mount, like the period in App.jsx.
  const [initialList] = useState(readListView);
  const [sort, setSort] = useState(initialList.sort);
  const [editingId, setEditingId] = useState(null);
  const [showEnded, setShowEnded] = useState(initialList.showEnded);
  const [showArchived, setShowArchived] = useState(initialList.showArchived);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reactivationTarget, setReactivationTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [catPanelOpen, setCatPanelOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  // The last write that went through, said next to where it happened (see
  // SaveNotice.jsx). `where` is "add" for the desktop add form, which stays
  // on screen after a save, and "list" for everything else.
  const [notice, setNotice] = useState(null);
  // Mobile-only: the add sheet has no desktop equivalent (desktop scrolls to
  // the always-visible inline form instead), and is shared between the
  // populated view's fixed action bar and the empty state's "Add it
  // yourself" button -- one sheet, two openers, rather than two.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // Desktop's inline add form starts folded: the page is a statement first,
  // and the list's own Add button and the n shortcut open it when it is
  // wanted. Once open it stays open, so adding several in a row is not a
  // click per subscription.
  const [addOpen, setAddOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    writeView({ period, sort, showEnded, showArchived });
  }, [period, sort, showEnded, showArchived]);

  // Two accelerators for the two things people come back to do (issue #67):
  // "/" to search the list, "n" to add a subscription. Never while typing,
  // with a modifier held, or with a dialog open -- those keys belong to
  // whatever has focus then. The handler reads the latest focusAddForm
  // through a ref so the listener is attached once.
  const shortcuts = useRef(null);
  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target.closest?.("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("[aria-modal=true]")) return;
      if (event.key === "/") {
        const search = document.querySelector(".subscription-search-input");
        if (!search) return;
        event.preventDefault();
        search.scrollIntoView({ behavior: "smooth", block: "center" });
        search.focus({ preventScroll: true });
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        shortcuts.current?.add();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { view, year, month } = period;
  const monthly = view === "monthly";

  // Any period change closes the picker; the one exception is the picker's own
  // year stepper, which is still choosing.
  function changePeriod(patch, { keepPicker = false } = {}) {
    setPeriod({ ...period, ...patch });
    if (!keepPicker) setPickerOpen(false);
  }

  // --- period figures, from the server's month-by-month breakdown ---

  const monthTotal = (y, m) => {
    const entry = spendByYear[y]?.months.find((row) => row.month === m + 1);
    return entry ? entry.total : null;
  };
  const yearTotal = (y) => (spendByYear[y] ? spendByYear[y].total : null);

  const total = (monthly ? monthTotal(year, month) : yearTotal(year)) ?? 0;
  const previous = monthly
    ? month === 0 ? monthTotal(year - 1, 11) : monthTotal(year, month - 1)
    : yearTotal(year - 1);
  const change = previous == null ? null : total - previous;

  // --- currencies ---
  //
  // Every figure from /summary/spend is already in the user's currency. A
  // period whose charges include another currency is converted, so its
  // figures are marked "≈" and the hero lists what charged in each currency.
  const monthSummary = (y, m) => spendByYear[y]?.months.find((row) => row.month === m + 1);
  const periodSummary = monthly ? monthSummary(year, month) : spendByYear[year];
  const previousSummary = monthly
    ? month === 0 ? monthSummary(year - 1, 11) : monthSummary(year, month - 1)
    : spendByYear[year - 1];
  const converts = (summary) => (summary?.by_currency ?? []).some((line) => isForeign(line.currency));
  const totalApprox = converts(periodSummary);
  const changeApprox = totalApprox || converts(previousSummary);
  // The same subscriptions charging the same native amounts in both periods:
  // any change in the converted figure is then the exchange rate alone, and
  // the KPI says so rather than leaving it to look like a price change.
  const chargeKey = (summary) =>
    summary &&
    JSON.stringify([
      monthly ? summary.subscription_ids : summary.months.map((row) => row.subscription_ids),
      (summary.by_currency ?? []).map((line) => [line.currency, line.native]),
    ]);
  const rateOnly =
    changeApprox &&
    change != null &&
    Math.round(change * 100) !== 0 &&
    chargeKey(periodSummary) === chargeKey(previousSummary);

  const activeSubs = subscriptions.filter(
    (s) => s.status === "active" && (!s.started_date || s.started_date <= todayISO()),
  );
  const trials = subscriptions.filter((s) => s.status === "trial");
  const usedCategories = [...new Set(activeSubs.map((s) => s.category).filter(Boolean))];

  // --- by category ---
  //
  // One /summary/spend request per category, cached per (year, category), so
  // past periods get the server's started/cancelled-aware arithmetic rather
  // than a client-side sum that is only right for the current month.
  //
  // Which categories appear is a wider question than "has an active plan":
  // /summary/spend counts a paused or cancelled plan up to the day it
  // stopped, including a yearly charge taken before that day, so a category
  // can carry a real amount for the period with nothing active in it. Listing
  // only active ones would print a figure with no rows behind it.
  // The members line follows the same rule and lists everyone who actually
  // charged in the selected period, not everyone still carrying the
  // category label -- a category can hold several subscriptions on
  // different schedules, and only some of them may have billed in any given
  // month. `subscription_ids` on each month is the server's own answer to
  // that (see _charge_dates), so a plan cancelled long ago can still be
  // named here if a past period's figure includes it, without a plan that
  // simply shares the category but didn't bill this month tagging along.
  // Cancelled plans are candidates like any other (issue #54): a category
  // whose only plan was cancelled in June still billed January to June.
  const chargedIn = (summary) =>
    new Set(
      monthly
        ? (summary.months.find((row) => row.month === month + 1)?.subscription_ids ?? [])
        : summary.months.flatMap((row) => row.subscription_ids),
    );
  const categoryRows = [...new Set(subscriptions.map((s) => s.category).filter(Boolean))]
    .map((name) => {
      const summary = spendByCategory[`${year}|${name}`];
      const amount = summary
        ? monthly
          ? (summary.months.find((row) => row.month === month + 1)?.total ?? 0)
          : summary.total
        : 0;
      const chargedIds = summary ? chargedIn(summary) : new Set();
      return {
        name,
        amount,
        loaded: Boolean(summary),
        approx: summary
          ? converts(monthly ? summary.months.find((row) => row.month === month + 1) : summary)
          : false,
        // A member billed in another currency is named with what it charges
        // in that currency, since the bar's amount is converted.
        members: subscriptions
          .filter((s) => s.category === name && chargedIds.has(s.id))
          .map((s) => (monthly && isForeign(s.currency) ? `${s.name} (${money(s.cost, s.currency)})` : s.name)),
      };
    })
    // Largest share first: a bar chart read top to bottom should be ordered
    // by the thing the bars are showing.
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  // Split the categories that billed from the ones that did not. A category
  // that only holds a trial, a paused plan or a yearly plan renewing in
  // another month still counts in the hero's "in N categories", so it is
  // named under the bars rather than left out: the half stays honest, and
  // the numbers on the page agree with each other.
  const idleCategories = categoryRows
    // Not until its figure has arrived, or every category would read as
    // idle for the moment the page is loading.
    .filter((row) => row.loaded && row.amount <= 0.005)
    .filter((row) => subscriptions.some((s) => s.category === row.name && s.status !== "cancelled"))
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));
  const billedRows = categoryRows.filter((row) => row.amount > 0.005);

  // Whatever the categories do not account for belongs to subscriptions with
  // no category at all -- there is no way to ask the API for those directly,
  // since an absent `category` filter means "all of them". The members are
  // the uncategorised plans the all-subscriptions breakdown says billed.
  const uncategorised = total - billedRows.reduce((sum, row) => sum + row.amount, 0);
  if (uncategorised > 0.005 && subscriptions.some((s) => !s.category)) {
    const chargedIds = spendByYear[year] ? chargedIn(spendByYear[year]) : new Set();
    billedRows.push({
      name: t("categoryBars.uncategorised"),
      amount: uncategorised,
      approx: totalApprox,
      members: subscriptions.filter((s) => !s.category && chargedIds.has(s.id)).map((s) => s.name),
    });
  }

  // --- coming up ---

  // A month is the current one, already over or still ahead, judged against
  // today. Only the current month has charges on both sides of today, and
  // only there does "coming up" need splitting: a charge from the 2nd is
  // not coming up on the 5th.
  const today = todayISO();
  const selectedMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthKind =
    selectedMonth === today.slice(0, 7) ? "current" : selectedMonth < today ? "past" : "future";
  const monthCharges = chargesInMonth(subscriptions, year, month);
  const chargesToCome = monthKind === "current" ? monthCharges.filter((c) => c.iso >= today) : monthCharges;
  const chargesTaken = monthKind === "current" ? monthCharges.filter((c) => c.iso < today) : [];
  const nextYearly = activeSubs
    .filter((s) => s.billing_cycle === "yearly")
    .sort((a, b) => a.next_renewal_date.localeCompare(b.next_renewal_date))[0];
  const comingUpNote = nextYearly
    ? t("comingUp.nextAnnual", {
        name: nextYearly.name,
        amount: money(nextYearly.cost, nextYearly.currency),
        date: longDate(nextYearly.next_renewal_date),
      })
    : t("comingUp.noAnnual");

  // --- trend ---

  const bars = monthly
    ? Array.from({ length: 12 }, (_, index) => shortMonthName(index)).map((tick, index) => ({
        tick,
        label: t("period.monthYear", { month: monthName(index), year }),
        // Mobile's 12-column tick row has no room for three letters (see
        // TrendStrip.jsx) -- a year has only three columns and keeps its
        // full label there too, so this is monthly-only.
        shortTick: tick[0],
        value: monthTotal(year, index) ?? 0,
        approx: converts(monthSummary(year, index)),
        on: index === month,
        go: () => changePeriod({ month: index }),
      }))
    : Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map((y) => ({
        tick: String(y),
        shortTick: String(y),
        value: yearTotal(y) ?? 0,
        approx: converts(spendByYear[y]),
        on: y === year,
        go: () => changePeriod({ year: y }),
      }));

  // --- KPIs ---

  const largestPool = monthly ? activeSubs.filter((s) => s.billing_cycle === "monthly") : activeSubs;
  // Compared in the user's currency, so $20.00 ranks beside €17.05 rather
  // than beside €20.00; shown in its own.
  const largest = largestPool
    .slice()
    .sort((a, b) => comparable(b.cost, b.currency) - comparable(a.cost, a.currency))[0];

  // Trials converting inside the same 30 days. The route counts them at 0 --
  // nothing has charged yet -- so the figure says so. One such trial is
  // always the one the next-charge strip shows, name and "if kept" price
  // included, so the note points there instead of saying it a second time.
  // Several only get their sum here, which nothing else on the page gives.
  const horizon = new Date(`${today}T00:00:00`);
  horizon.setDate(horizon.getDate() + 30);
  const trialsSoon = trials.filter((s) => s.next_renewal_date >= today && s.next_renewal_date <= toISO(horizon));
  // In the user's currency, each at the latest rate: none has charged yet.
  const trialsSoonCost = trialsSoon.reduce(
    (sum, s) => sum + (convert(s.cost, s.currency, s.next_renewal_date) ?? 0),
    0,
  );
  const trialsSoonNote =
    trialsSoon.length === 0
      ? null
      : trialsSoon.length === 1
        ? t("kpi.trialNoteOne")
        : t("kpi.trialNoteMany", {
            n: trialsSoon.length,
            amount: trialsSoon.some((s) => isForeign(s.currency)) ? approxText(trialsSoonCost) : money(trialsSoonCost),
          });

  const kpis = [
    {
      // The real answer from GET /subscriptions/upcoming, not a share of the
      // selected period: "the next 30 days" is a question about today, and it
      // does not change when the period picker moves.
      figure: monthly ? money(upcomingTotal ?? 0) : money(total / 12),
      approx: monthly ? upcomingApprox : totalApprox,
      label: monthly ? t("kpi.next30") : t("kpi.averagePerMonth"),
      note: monthly ? trialsSoonNote : null,
    },
    {
      figure: String(monthly ? monthCharges.length : chargeCountInYear(subscriptions, year)),
      label: monthly ? t("kpi.renewalsMonth") : t("kpi.renewalsYear"),
    },
    {
      figure: largest ? money(largest.cost, largest.currency) : "—",
      label: t("kpi.largest", { name: largest ? largest.name : t("kpi.largestNone") }),
      note:
        largest && isForeign(largest.currency)
          ? approxText(convert(largest.cost, largest.currency) ?? 0)
          : null,
    },
    {
      figure: change == null ? "—" : signed(change),
      approx: change != null && changeApprox,
      note: rateOnly
        ? t("fx.rateOnly", monthly ? { month: monthName((month + 11) % 12) } : { year: year - 1 })
        : null,
      label:
        change == null
          ? t("kpi.noEarlier")
          : monthly
            ? t("kpi.changeSinceMonth", {
                month: monthName((month + 11) % 12),
                shortMonth: shortMonthName((month + 11) % 12),
              })
            : t("kpi.changeSinceYear", { year: year - 1 }),
    },
  ];

  // --- actions ---

  // A quick-add tile's prefill has to be cleared once it's been used --
  // otherwise it outlives the AddForm instance that consumed it (the empty
  // state's form unmounts the moment the first subscription lands, and a
  // fresh AddForm mounts in its place downstream) and reapplies itself to
  // that new, otherwise-blank form. The symptom is a form that looks like it
  // never cleared, now flagging the subscription it just created as a
  // duplicate of itself.
  async function handleCreate(payload, where = "list") {
    await actions.create(payload);
    setPrefill(null);
    say(() => t("saveNotice.added", { name: payload.name }), { where });
  }

  // --- saying that a write went through ---

  // `message` (and an action's label) is a function that returns the text,
  // called when the notice renders, so a notice still on screen follows a
  // switch of language.
  function say(message, { where = "list", action = null } = {}) {
    setNotice({ seq: Date.now(), where, message, action });
  }

  // Undo is offered only where it is the exact opposite write: archive and
  // unarchive, and converting a trial. A cancel has no undo -- the API does
  // not let a cancelled run go back (reactivating starts a new run instead).
  function undoable(write) {
    return {
      label: () => t("saveNotice.undo"),
      run: async () => {
        try {
          await write();
        } catch (err) {
          // A 404 already turned the row into "removed on another device".
          if (err instanceof ApiError && err.status === 404) { setNotice(null); return; }
          say(() => t("saveNotice.undoFailed", { error: describeWriteError(err) }));
        }
      },
    };
  }

  async function saveRow(id, patch) {
    await actions.update(id, patch);
    say(() => t("saveNotice.saved", { name: patch.name }));
  }

  async function archive(subscription) {
    await actions.archive(subscription.id);
    // Archived rows stay out of the list until "Show archived" is on, so the
    // row has just vanished -- say where it went.
    say(
      () => t(showArchived ? "saveNotice.archived" : "saveNotice.archivedHidden", { name: subscription.name }),
      {
        action: undoable(async () => {
          await actions.unarchive(subscription.id);
          say(() => t("saveNotice.backInList", { name: subscription.name }));
        }),
      },
    );
  }

  // Every ended plan still in the list, archived in one go -- the ended list
  // only grows, and archiving it row by row is a chore. The same set
  // "Show ended — N" counts: heads of ended groups that are not archived yet.
  // A cancelled plan whose access is still running is not part of it.
  async function archiveAllEnded() {
    const targets = buildGroups(subscriptions)
      .map((g) => g.head)
      .filter((s) => accessEnded(s) && !s.archived_date);
    if (targets.length === 0) return;
    const ids = targets.map((s) => s.id);
    try {
      await actions.archiveMany(ids);
    } catch (err) {
      // Some may have gone through; the reload already shows which.
      say(() => t("saveNotice.archiveAllFailed", { error: describeWriteError(err) }));
      return;
    }
    const one = targets.length === 1;
    const vars = { name: targets[0].name, n: targets.length };
    const archived = one
      ? showArchived ? "saveNotice.archived" : "saveNotice.archivedHidden"
      : showArchived ? "saveNotice.archivedMany" : "saveNotice.archivedManyHidden";
    say(() => t(archived, vars), {
      action: undoable(async () => {
        await actions.unarchiveMany(ids);
        say(() => t(one ? "saveNotice.backInList" : "saveNotice.backInListMany", vars));
      }),
    });
  }

  async function unarchive(subscription) {
    await actions.unarchive(subscription.id);
    say(() => t("saveNotice.restored", { name: subscription.name }), {
      action: undoable(async () => {
        await actions.archive(subscription.id);
        say(() => t("saveNotice.archivedAgain", { name: subscription.name }));
      }),
    });
  }

  async function cancelPlan(subscription, payload) {
    const updated = await actions.update(subscription.id, { status: "cancelled", ...payload });
    // The server works out when the paid-for term runs out. Until then the
    // row stays where it is (issue #53), so the notice says how long for;
    // a cancel back-dated past its own term has ended already and leaves the
    // list unless "Show ended" is on, so the way back to it is the one action
    // worth offering.
    const row = { ...subscription, ...payload, ...updated, status: "cancelled" };
    if (!accessEnded(row)) {
      say(() => t("saveNotice.cancelledStays", { name: subscription.name, date: longDate(row.next_renewal_date) }));
      return;
    }
    say(
      () => t("saveNotice.cancelled", { name: subscription.name }),
      showEnded
        ? {}
        : { action: { label: () => t("saveNotice.showEnded"), run: () => { setShowEnded(true); setNotice(null); } } },
    );
  }

  // A dialog's write, then the dialog closes -- in that order, so a failure
  // can be said inside the dialog that asked for it (the dialog catches what
  // this rethrows). The exception is a 404: the record is gone, App has
  // already marked its row "removed on another device", and that row, not
  // the dialog, is where the explanation belongs.
  // Shared by the trial banner and the next-charge strip.
  function convertTrial(subscription) {
    return thenClose(async () => {
      await actions.update(subscription.id, {
        status: "active",
        // The conversion date becomes the first charge -- it's what the trial
        // was going to do anyway.
        started_date: subscription.next_renewal_date,
        next_renewal_date: subscription.next_renewal_date,
      });
      say(() => t("saveNotice.converted", { name: subscription.name }), {
        // Back to the trial exactly as it was: its own start and end dates.
        action: undoable(async () => {
          await actions.update(subscription.id, {
            status: "trial",
            started_date: subscription.started_date,
            next_renewal_date: subscription.next_renewal_date,
          });
          say(() => t("saveNotice.trialAgain", { name: subscription.name }));
        }),
      });
    }, () => {});
  }

  async function thenClose(write, close) {
    try {
      await write();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        close();
        return;
      }
      throw err;
    }
    close();
  }

  async function remove(subscription) {
    await actions.remove(subscription.id);
    say(() => t("saveNotice.deleted", { name: subscription.name }));
  }

  function quickAdd(service) {
    // A new object every time, so tapping the same tile twice re-applies it.
    setPrefill({ name: service.name, cost: service.monthlyCost, billing_cycle: "monthly" });
    // Desktop scrolls the always-visible form into view instead (below); on
    // mobile there is nothing to scroll to until the sheet is open.
    if (isMobile) setAddSheetOpen(true);
  }

  function focusAddForm() {
    if (isMobile) { setAddSheetOpen(true); return; }
    // Rendered open before it is focused: a field under `hidden` takes no
    // focus.
    flushSync(() => setAddOpen(true));
    document.getElementById("add")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelector("#add input")?.focus();
  }

  useEffect(() => {
    shortcuts.current = { add: focusAddForm };
  });

  function openExisting(subscription) {
    // On mobile this fires from inside the add sheet (the duplicate-name
    // warning), which has to close before the edit sheet it hands off to can
    // open -- both use .dialog-backdrop, and two stacked at once is not what
    // either sheet is for.
    setAddSheetOpen(false);
    setEditingId(subscription.id);
    if (!isMobile) {
      document.getElementById("all")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  if (subscriptions.length === 0) {
    return (
      <div className="page">
        <EmptyState
          categories={categories}
          onSubmit={handleCreate}
          prefill={prefill}
          onQuickAdd={quickAdd}
          actions={actions}
          onOpenAddSheet={() => setAddSheetOpen(true)}
        />
        {addSheetOpen && (
          <Sheet title={t("dashboard.addTitle")} onClose={() => setAddSheetOpen(false)}>
            <AddForm
              categories={categories}
              existing={subscriptions}
              onSubmit={handleCreate}
              onOpenExisting={openExisting}
              prefill={prefill}
              onSuccess={() => setAddSheetOpen(false)}
            />
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="page">
        <Hero
          view={view}
          year={year}
          month={month}
          total={total}
          activeCount={activeSubs.length}
          categoryCount={usedCategories.length}
          currencyCount={new Set(activeSubs.map((s) => s.currency)).size}
          byCurrency={periodSummary?.by_currency ?? []}
          ratesAsOf={spendByYear[year]?.rates_as_of}
          ratesStale={spendByYear[year]?.rates_stale}
          onChange={changePeriod}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
        >
          <NextCharge subscriptions={subscriptions} onConvert={convertTrial} onCancel={setCancelTarget} />
        </Hero>

        <hr className="rule" />

        <TrendStrip
          label={`${monthly ? t("trend.perMonth", { year }) : t("trend.perYear")}${
            bars.some((bar) => bar.approx) ? ` · ${inCurrency()}` : ""
          }`}
          bars={bars}
          onSelect={(bar) => bar.go()}
        />

        <hr className="rule" style={{ margin: "42px 0 0" }} />

        <KpiBand cells={kpis} />

        <section className="split">
          <CategoryBars
            rows={billedRows}
            idle={idleCategories}
            idleLabel={
              monthly
                ? t("categoryBars.idleMonth", { month: monthName(month) })
                : t("categoryBars.idleYear", { year })
            }
            total={total}
            inCurrency={billedRows.some((row) => row.approx) ? inCurrency() : null}
            onManage={() => setCatPanelOpen(true)}
          />
          <ComingUp
            kind={monthKind}
            monthLabel={t("period.monthYear", { month: monthName(month), year })}
            charges={chargesToCome}
            charged={chargesTaken}
            note={comingUpNote}
          />
        </section>

        {/* The trial section's own Signal Red top rule takes the place of
            this divider rather than stacking a second rule under it. It is
            the full list of running trials, so it only earns its place when
            there is more to list than the next-charge strip already shows:
            one trial still to convert is in the strip, actions included. */}
        {trials.length > 1 || (trials.length === 1 && trials[0].next_renewal_date < today) ? (
          <TrialBanner
            trials={trials}
            year={year}
            month={month}
            onReview={() => {
              // Sorted by status, trials come straight after the active
              // plans. Go there, so the click visibly does something.
              setSort({ key: "status", dir: "asc" });
              document.getElementById("all")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onConvert={convertTrial}
            onCancel={setCancelTarget}
          />
        ) : (
          <hr className="rule" />
        )}

        <SubscriptionTable
          subscriptions={subscriptions}
          categories={categories}
          sort={sort}
          setSort={setSort}
          showEnded={showEnded}
          setShowEnded={setShowEnded}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          editingId={editingId}
          setEditingId={setEditingId}
          onSave={saveRow}
          onCancelPlan={setCancelTarget}
          onReactivate={setReactivationTarget}
          onArchive={archive}
          onUnarchive={unarchive}
          onArchiveAllEnded={archiveAllEnded}
          notice={<SaveNotice notice={notice?.where === "list" ? notice : null} />}
          onDelete={setDeleteTarget}
          onAdd={focusAddForm}
          staleId={staleId}
          onRefreshStale={actions.refresh}
        />

        <ListGuide />

        <section id="add" aria-label={t("dashboard.addTitle")} className={addOpen ? "add-section" : "add-section folded"}>
          <SectionToggle
            title={t("dashboard.addTitle")}
            open={addOpen}
            onToggle={() => setAddOpen((open) => !open)}
            controls="add-body"
          />
          <div id="add-body" className="section-body" hidden={!addOpen}>
            <AddForm
              categories={categories}
              existing={subscriptions}
              onSubmit={(payload) => handleCreate(payload, "add")}
              onOpenExisting={openExisting}
              prefill={prefill}
            />
          </div>
          {/* Outside the fold, so "added" still shows if it was closed
              while the save was in flight. */}
          <SaveNotice notice={notice?.where === "add" ? notice : null} />
        </section>

        {/* Last on the page, quiet and folded, because it is maintenance
            rather than anything to do with what the subscriptions cost. */}
        <ImportExport
          subscriptions={subscriptions}
          categories={categories}
          onImport={actions.importBackup}
          onExport={actions.exportBackup}
        />
      </div>

      {/* Mobile only (hidden by the media query in dashboard.css): the
          add-section above is desktop's always-visible form, and this
          fixed-position bar is what reaches it without scrolling back up to
          the table. It holds that one action and nothing else: every row of
          it covers the trial and next-charge actions as they scroll past,
          and the ended toggle already sits with the list it filters.
          Rendered unconditionally, like the header's avatar square, rather
          than gated on isMobile -- CSS decides whether it's on screen, JS
          just supplies the handler. */}
      <div className="mobile-action-bar">
        <button type="button" className="btn btn-primary" onClick={focusAddForm}>
          {t("dashboard.addButton")}
        </button>
      </div>

      {addSheetOpen && (
        <Sheet title={t("dashboard.addTitle")} onClose={() => setAddSheetOpen(false)}>
          <AddForm
            categories={categories}
            existing={subscriptions}
            onSubmit={handleCreate}
            onOpenExisting={openExisting}
            prefill={prefill}
            onSuccess={() => setAddSheetOpen(false)}
          />
        </Sheet>
      )}

      {catPanelOpen && (
        <CategoriesDialog
          categories={categories}
          subscriptions={subscriptions}
          onCreate={actions.createCategory}
          onRename={actions.renameCategory}
          onDelete={actions.deleteCategory}
          onClose={() => setCatPanelOpen(false)}
        />
      )}

      {cancelTarget && (
        <CancelDialog
          subscription={cancelTarget}
          onConfirm={(payload) =>
            thenClose(
              () => cancelPlan(cancelTarget, payload),
              () => setCancelTarget(null),
            )
          }
          onClose={() => setCancelTarget(null)}
        />
      )}

      {reactivationTarget && (
        <ReactivateDialog
          subscription={reactivationTarget}
          onConfirm={(payload) =>
            thenClose(async () => {
              await actions.restore(reactivationTarget.id, payload);
              say(() => t("saveNotice.reactivated", { name: reactivationTarget.name }));
            }, () => setReactivationTarget(null))
          }
          onClose={() => setReactivationTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t("dashboard.deleteTitle", { name: deleteTarget.name })}
          body={t("dashboard.deleteBody")}
          confirmLabel={t("dashboard.deleteConfirm")}
          onConfirm={() => thenClose(() => remove(deleteTarget), () => setDeleteTarget(null))}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

export default Dashboard;
