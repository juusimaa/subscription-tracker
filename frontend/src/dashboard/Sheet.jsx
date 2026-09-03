// A generic dialog shell, mobile-only in practice: used for the three
// bottom sheets that have no desktop dialog of their own to piggyback on
// (add, row detail, edit -- handoff section 14). Every other dialog in this
// app (Categories, Confirm, Restore, Import summary, Account) already shares
// the same .dialog-backdrop / .dialog markup with its own width class, and
// the general mobile rule at the bottom of dashboard.css re-chromes those
// into bottom sheets without any component change. This one exists so these
// three get the same treatment despite never being mounted on desktop.

function Sheet({ title, header, onClose, children, className = "" }) {
  return (
    <div className="dialog-backdrop confirm" onClick={onClose}>
      <div
        className={`dialog dialog-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          {/* header overrides the plain title paragraph for the one caller
              (the row detail sheet) whose title is a tile-plus-name row, not
              plain text -- title itself still does double duty as the
              dialog's aria-label either way. */}
          {header || <p className="dialog-title">{title}</p>}
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Sheet;
