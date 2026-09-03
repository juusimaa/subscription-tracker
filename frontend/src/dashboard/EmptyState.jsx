// What a new user sees. Everything between the header and the page end is
// replaced -- no zeroed-out charts, no empty table with a "no rows" line.
// A dashboard of dashes is worse than an invitation.

import MonoTile from "../MonoTile";
import { QUICK_ADD } from "../services";
import { useIsMobile } from "../useMediaQuery";
import AddForm from "./AddForm";
import ImportExport from "./ImportExport";

function EmptyState({ categories, onSubmit, prefill, onQuickAdd, actions, onOpenAddSheet }) {
  // Mobile trades the always-visible form for a button that opens the same
  // add sheet the populated page's fixed action bar uses (Dashboard.jsx owns
  // that sheet, since it has to be reachable from both states). Import
  // already behaves the mobile way without any change here -- "Import a
  // file" below opens the native file picker on both layouts, which is
  // exactly what the handoff asks phones to do instead of a drop zone.
  const isMobile = useIsMobile();
  return (
    <>
      <section className="empty-hero">
        <span className="eyebrow">Nothing tracked yet</span>
        <p className="empty-total">€0.00 a month.</p>
        <p className="empty-body">
          Add the first subscription and this page fills in — monthly and yearly totals, spend by
          category, and every renewal date in order. Start with one you know off the top of your head.
        </p>
      </section>

      <section aria-label="Common subscriptions" className="quick-add-section">
        <span className="eyebrow">One tap to add</span>
        <div className="quick-add">
          {QUICK_ADD.map((service) => (
            <button key={service.name} type="button" onClick={() => onQuickAdd(service)}>
              <MonoTile brand={service} />
              <span className="name">{service.name}</span>
              <span className="plus">+</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Add a subscription manually" className="manual-add-section">
        <span className="eyebrow">Or add it yourself</span>
        {isMobile ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={onOpenAddSheet}>
            Add it yourself
          </button>
        ) : (
          // A tile pre-fills this form with the service's name and typical
          // price; it does not save silently.
          <AddForm categories={categories} onSubmit={onSubmit} prefill={prefill} endAligned />
        )}

        {/* Import is offered here too -- a list that already exists somewhere
            is the fastest way out of an empty page. Export is not: there is
            nothing yet to export. */}
        <ImportExport
          variant="entry"
          subscriptions={[]}
          categories={categories}
          onImport={actions.importBackup}
        />
      </section>
    </>
  );
}

export default EmptyState;
