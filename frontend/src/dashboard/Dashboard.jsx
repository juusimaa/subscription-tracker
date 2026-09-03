// The dashboard proper: one screen, one selected period, everything on it
// derived from that selection.
//
// Nothing here fetches. App.jsx owns the data and the error states; this
// component owns the view state (which period, which sort, which row is being
// edited, which dialog is open) and the arithmetic that turns the API's
// answers into the figures the design asks for.

import { useState } from "react";
import { MAX_YEAR, MIN_YEAR, SHORT_MONTHS, longDate, money, signed } from "../format";
import { chargeCountInYear, chargesInMonth } from "../renewals";
import { useIsMobile } from "../useMediaQuery";
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
import RestoreDialog from "./RestoreDialog";
import Sheet from "./Sheet";
import SubscriptionTable from "./SubscriptionTable";
import TrendStrip from "./TrendStrip";
import TrialBanner from "./TrialBanner";

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
  const [sort, setSort] = useState({ key: "renewal", dir: "asc" });
  const [editingId, setEditingId] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [catPanelOpen, setCatPanelOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  // Mobile-only: the add sheet has no desktop equivalent (desktop scrolls to
  // the always-visible inline form instead), and is shared between the
  // populated view's fixed action bar and the empty state's "Add it
  // yourself" button -- one sheet, two openers, rather than two.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const isMobile = useIsMobile();

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

  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const trials = subscriptions.filter((s) => s.status === "trial");
  // Same count SubscriptionTable computes for itself -- needed here too for
  // the mobile fixed action bar's label, which sits outside that component.
  const cancelledCount = subscriptions.filter(
    (s) => s.status === "cancelled" && !s.archived_date,
  ).length;
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
  // The members line follows the same rule and lists everything still on the
  // books; a plan cancelled long ago can still be inside a past period's
  // figure without being named, which is the one place this under-reports.
  const onTheBooks = subscriptions.filter((s) => s.status !== "cancelled");
  const categoryRows = [...new Set(onTheBooks.map((s) => s.category).filter(Boolean))]
    .map((name) => {
      const summary = spendByCategory[`${year}|${name}`];
      const amount = summary
        ? monthly
          ? (summary.months.find((row) => row.month === month + 1)?.total ?? 0)
          : summary.total
        : 0;
      return {
        name,
        amount,
        members: onTheBooks.filter((s) => s.category === name).map((s) => s.name),
      };
    })
    .filter((row) => row.amount > 0.005)
    // Largest share first: a bar chart read top to bottom should be ordered
    // by the thing the bars are showing.
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  // Whatever the categories do not account for belongs to subscriptions with
  // no category at all -- there is no way to ask the API for those directly,
  // since an absent `category` filter means "all of them".
  const uncategorised = total - categoryRows.reduce((sum, row) => sum + row.amount, 0);
  if (uncategorised > 0.005 && onTheBooks.some((s) => !s.category)) {
    categoryRows.push({
      name: "Uncategorised",
      amount: uncategorised,
      members: onTheBooks.filter((s) => !s.category).map((s) => s.name),
    });
  }

  // --- coming up ---

  const charges = chargesInMonth(subscriptions, year, month);
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

  const kpis = [
    {
      // The real answer from GET /subscriptions/upcoming, not a share of the
      // selected period: "the next 30 days" is a question about today, and it
      // does not change when the period picker moves.
      figure: monthly ? money(upcomingTotal ?? 0) : money(total / 12),
      label: monthly ? "Charging in the next 30 days" : "Average per month",
    },
    {
      figure: String(monthly ? charges.length : chargeCountInYear(subscriptions, year)),
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

  function quickAdd(service) {
    // A new object every time, so tapping the same tile twice re-applies it.
    setPrefill({ name: service.name, cost: service.monthlyCost, billing_cycle: "monthly" });
    // Desktop scrolls the always-visible form into view instead (below); on
    // mobile there is nothing to scroll to until the sheet is open.
    if (isMobile) setAddSheetOpen(true);
  }

  function focusAddForm() {
    if (isMobile) { setAddSheetOpen(true); return; }
    document.getElementById("add")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelector("#add input")?.focus();
  }

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
          onSubmit={actions.create}
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
              onSubmit={actions.create}
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
        />

        <hr className="rule" />

        <TrendStrip
          label={monthly ? `Per month · ${year}` : "Per year"}
          bars={bars}
          onSelect={(bar) => bar.go()}
        />

        <hr className="rule" style={{ margin: "42px 0 0" }} />

        <KpiBand cells={kpis} />

        <section className="split">
          <CategoryBars rows={categoryRows} total={total} onManage={() => setCatPanelOpen(true)} />
          <ComingUp charges={charges} note={comingUpNote} />
        </section>

        <hr className="rule" />

        {trials.length > 0 && (
          <TrialBanner
            trials={trials}
            year={year}
            month={month}
            onReview={() => setSort({ key: "status", dir: "asc" })}
          />
        )}

        <SubscriptionTable
          subscriptions={subscriptions}
          categories={categories}
          sort={sort}
          setSort={setSort}
          showCancelled={showCancelled}
          setShowCancelled={setShowCancelled}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          editingId={editingId}
          setEditingId={setEditingId}
          onSave={actions.update}
          onCancelPlan={setCancelTarget}
          onReactivate={(subscription) => actions.update(subscription.id, { status: "active" })}
          onRestore={setRestoreTarget}
          onArchive={(subscription) => actions.archive(subscription.id)}
          onUnarchive={(subscription) => actions.unarchive(subscription.id)}
          onDeleteArchived={setDeleteTarget}
          onAdd={focusAddForm}
          staleId={staleId}
          onRefreshStale={actions.refresh}
        />

        <section id="add" aria-label="Add a subscription" className="add-section">
          <span className="eyebrow" style={{ margin: "0 0 28px" }}>Add a subscription</span>
          <AddForm
            categories={categories}
            existing={subscriptions}
            onSubmit={actions.create}
            onOpenExisting={openExisting}
            prefill={prefill}
          />
        </section>

        {/* Last on the page and quiet, because it is maintenance rather than
            anything to do with what the subscriptions cost. */}
        <ImportExport
          subscriptions={subscriptions}
          categories={categories}
          onImport={actions.importBackup}
          onExport={actions.exportBackup}
        />
      </div>

      {/* Mobile only (hidden by the media query in dashboard.css): the
          add-section above is desktop's always-visible form, and this
          fixed-position bar is what reaches it and the cancelled toggle
          without scrolling back up to the table. Rendered unconditionally,
          like the header's avatar square, rather than gated on isMobile --
          CSS decides whether it's on screen, JS just supplies the handlers. */}
      <div className="mobile-action-bar">
        <button type="button" className="btn btn-primary" onClick={focusAddForm}>
          Add subscription
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setShowCancelled(!showCancelled)}>
          {showCancelled ? "Hide cancelled" : `Show cancelled — ${cancelledCount}`}
        </button>
      </div>

      {addSheetOpen && (
        <Sheet title="Add a subscription" onClose={() => setAddSheetOpen(false)}>
          <AddForm
            categories={categories}
            existing={subscriptions}
            onSubmit={actions.create}
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
          onConfirm={async (payload) => {
            const target = cancelTarget;
            setCancelTarget(null);
            await actions.update(target.id, { status: "cancelled", ...payload }).catch(() => {});
          }}
          onClose={() => setCancelTarget(null)}
          destructive={{
            label: "Delete permanently",
            onClick: async () => {
              const target = cancelTarget;
              setCancelTarget(null);
              await actions.remove(target.id).catch(() => {});
            },
          }}
        />
      )}

      {restoreTarget && (
        <RestoreDialog
          subscription={restoreTarget}
          onConfirm={async (payload) => {
            const target = restoreTarget;
            await actions.restore(target.id, payload).catch(() => {});
            setRestoreTarget(null);
          }}
          onClose={() => setRestoreTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.name} permanently?`}
          body="This removes the archived record and its past charges for good. There is no undoing this from here."
          confirmLabel="Delete permanently"
          onConfirm={async () => {
            const target = deleteTarget;
            setDeleteTarget(null);
            await actions.remove(target.id).catch(() => {});
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

export default Dashboard;
