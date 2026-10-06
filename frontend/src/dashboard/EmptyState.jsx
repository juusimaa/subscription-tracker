// What a new user sees. Everything between the header and the page end is
// replaced -- no zeroed-out charts, no empty table with a "no rows" line.
// A dashboard of dashes is worse than an invitation.

import { money } from "../format";
import { t } from "../i18n";
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
        <h1 className="eyebrow">{t("empty.title")}</h1>
        <p className="empty-total">{t("empty.total", { amount: money(0) })}</p>
        <p className="empty-body">
          {t("empty.body")}
        </p>
      </section>

      <section aria-label={t("empty.commonLabel")} className="quick-add-section">
        <h2 className="eyebrow">{t("empty.commonTitle")}</h2>
        {/* A tile only fills in the form, so it says so -- someone who
            expected it to save would otherwise not know a step is left. */}
        <p id="quick-add-note" className="quick-add-note">
          {t("empty.tileNote", { mobile: isMobile })}
        </p>
        <div className="quick-add">
          {QUICK_ADD.map((service) => (
            <button
              key={service.name}
              type="button"
              aria-describedby="quick-add-note"
              onClick={() => onQuickAdd(service)}
            >
              <MonoTile brand={service} />
              <span className="name">{service.name}</span>
              <span className="plus">+</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label={t("empty.manualLabel")} className="manual-add-section">
        <h2 className="eyebrow">{t("empty.manualTitle")}</h2>
        {isMobile ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={onOpenAddSheet}>
            {t("empty.manualButton")}
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
