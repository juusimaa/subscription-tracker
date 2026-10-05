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
import { MAX_YEAR, MIN_YEAR, MONTHS, SHORT_MONTHS, longDate, money, signed, toISO, todayISO } from "../format";
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
        members: subscriptions
          .filter((s) => s.category === name && chargedIds.has(s.id))
          .map((s) => s.name),
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
      name: "Uncategorised",
      amount: uncategorised,
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
    ? `Next annual charge: ${nextYearly.name}, ${money(nextYearly.cost)} on ${longDate(nextYearly.next_renewal_date)}.`
    : "No annual charges on record.";

  // --- trend ---

  const bars = monthly
    ? SHORT_MONTHS.map((tick, index) => ({
        tick,
        label: `${MONTHS[index]} ${year}`,
        // Mobile's 12-column tick row has no room for three letters (see
        // TrendStrip.jsx) -- a year has only three columns and keeps its
        // full label there too, so this is monthly-only.
        shortTick: tick[0],
        value: monthTotal(year, index) ?? 0,
        on: index === month,
        go: () => changePeriod({ month: index }),
      }))
    : Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map((y) => ({
        tick: String(y),
        shortTick: String(y),
        value: yearTotal(y) ?? 0,
        on: y === year,
        go: () => changePeriod({ year: y }),
      }));

  // --- KPIs ---

  const largestPool = monthly ? activeSubs.filter((s) => s.billing_cycle === "monthly") : activeSubs;
  const largest = largestPool.slice().sort((a, b) => Number(b.cost) - Number(a.cost))[0];

  // Trials converting inside the same 30 days. The route counts them at 0 --
  // nothing has charged yet -- so the figure says so, and gives the price
  // they bring if kept: the same "if kept" figure the strip, the banner and
  // Coming up show, rather than a fourth answer.
  const horizon = new Date(`${today}T00:00:00`);
  horizon.setDate(horizon.getDate() + 30);
  const trialsSoon = trials.filter((s) => s.next_renewal_date >= today && s.next_renewal_date <= toISO(horizon));
  const trialsSoonCost = trialsSoon.reduce((sum, s) => sum + Number(s.cost), 0);
  const trialsSoonNote =
    trialsSoon.length === 0
      ? null
      : trialsSoon.length === 1
        ? `Not counting the ${trialsSoon[0].name} trial: ${money(trialsSoonCost)} more if kept`
        : `Not counting ${trialsSoon.length} trials: ${money(trialsSoonCost)} more if kept`;

  const kpis = [
    {
      // The real answer from GET /subscriptions/upcoming, not a share of the
      // selected period: "the next 30 days" is a question about today, and it
      // does not change when the period picker moves.
      figure: monthly ? money(upcomingTotal ?? 0) : money(total / 12),
      label: monthly ? "Charging in the next 30 days" : "Average per month",
      note: monthly ? trialsSoonNote : null,
    },
    {
      figure: String(monthly ? monthCharges.length : chargeCountInYear(subscriptions, year)),
      label: monthly ? "Renewals this month" : "Renewals this year",
    },
    {
      figure: largest ? money(largest.cost) : "—",
      label: `Largest single charge — ${largest ? largest.name : "none"}`,
    },
    {
      figure: change == null ? "—" : signed(change),
      label:
        change == null
          ? "No earlier data"
          : monthly
            ? `Change since ${SHORT_MONTHS[(month + 11) % 12]}`
            : `Change since ${year - 1}`,
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
    say(`${payload.name} added.`, { where });
  }

  // --- saying that a write went through ---

  function say(message, { where = "list", action = null } = {}) {
    setNotice({ seq: Date.now(), where, message, action });
  }

  // Undo is offered only where it is the exact opposite write: archive and
  // unarchive, and converting a trial. A cancel has no undo -- the API does
  // not let a cancelled run go back (reactivating starts a new run instead).
  function undoable(write) {
    return {
      label: "Undo",
      run: async () => {
        try {
          await write();
        } catch (err) {
          // A 404 already turned the row into "removed on another device".
          if (err instanceof ApiError && err.status === 404) { setNotice(null); return; }
          say(`Couldn't undo. ${describeWriteError(err)}`);
        }
      },
    };
  }

  async function saveRow(id, patch) {
    await actions.update(id, patch);
    say(`${patch.name} saved.`);
  }

  async function archive(subscription) {
    await actions.archive(subscription.id);
    // Archived rows stay out of the list until "Show archived" is on, so the
    // row has just vanished -- say where it went.
    say(
      showArchived ? `${subscription.name} archived.` : `${subscription.name} archived and hidden from the list.`,
      {
        action: undoable(async () => {
          await actions.unarchive(subscription.id);
          say(`${subscription.name} is back in the list.`);
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
      say(`Couldn't archive every ended plan. ${describeWriteError(err)}`);
      return;
    }
    const one = targets.length === 1;
    const what = one ? targets[0].name : `${targets.length} ended plans`;
    say(showArchived ? `${what} archived.` : `${what} archived and hidden from the list.`, {
      action: undoable(async () => {
        await actions.unarchiveMany(ids);
        say(`${what} ${one ? "is" : "are"} back in the list.`);
      }),
    });
  }

  async function unarchive(subscription) {
    await actions.unarchive(subscription.id);
    say(`${subscription.name} restored to the list.`, {
      action: undoable(async () => {
        await actions.archive(subscription.id);
        say(`${subscription.name} archived again.`);
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
      say(`${subscription.name} marked as cancelled. It stays in the list until access ends ${longDate(row.next_renewal_date)}.`);
      return;
    }
    say(
      `${subscription.name} marked as cancelled.`,
      showEnded
        ? {}
        : { action: { label: "Show ended", run: () => { setShowEnded(true); setNotice(null); } } },
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
      say(`${subscription.name} converted to paid.`, {
        // Back to the trial exactly as it was: its own start and end dates.
        action: undoable(async () => {
          await actions.update(subscription.id, {
            status: "trial",
            started_date: subscription.started_date,
            next_renewal_date: subscription.next_renewal_date,
          });
          say(`${subscription.name} is a trial again.`);
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
    say(`${subscription.name} deleted.`);
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
          <Sheet title="Add a subscription" onClose={() => setAddSheetOpen(false)}>
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
          onChange={changePeriod}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
        >
          <NextCharge subscriptions={subscriptions} onConvert={convertTrial} onCancel={setCancelTarget} />
        </Hero>

        <hr className="rule" />

        <TrendStrip
          label={monthly ? `Per month · ${year}` : "Per year"}
          bars={bars}
          onSelect={(bar) => bar.go()}
        />

        <hr className="rule" style={{ margin: "42px 0 0" }} />

        <KpiBand cells={kpis} />

        <section className="split">
          <CategoryBars
            rows={billedRows}
            idle={idleCategories}
            periodLabel={monthly ? MONTHS[month] : String(year)}
            total={total}
            onManage={() => setCatPanelOpen(true)}
          />
          <ComingUp
            kind={monthKind}
            monthLabel={`${MONTHS[month]} ${year}`}
            charges={chargesToCome}
            charged={chargesTaken}
            note={comingUpNote}
          />
        </section>

        {/* The trial section's own Signal Red top rule takes the place of
            this divider rather than stacking a second rule under it. */}
        {trials.length > 0 ? (
          <TrialBanner
            trials={trials}
            year={year}
            month={month}
            onReview={() => setSort({ key: "status", dir: "asc" })}
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

        <section id="add" aria-label="Add a subscription" className={addOpen ? "add-section" : "add-section folded"}>
          <SectionToggle
            title="Add a subscription"
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
          Add subscription
        </button>
      </div>

      {addSheetOpen && (
        <Sheet title="Add a subscription" onClose={() => setAddSheetOpen(false)}>
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
              say(`${reactivationTarget.name} reactivated.`);
            }, () => setReactivationTarget(null))
          }
          onClose={() => setReactivationTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.name} permanently?`}
          body="This removes the subscription and its past charges for good. There is no undoing this from here."
          confirmLabel="Delete permanently"
          onConfirm={() => thenClose(() => remove(deleteTarget), () => setDeleteTarget(null))}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

export default Dashboard;
