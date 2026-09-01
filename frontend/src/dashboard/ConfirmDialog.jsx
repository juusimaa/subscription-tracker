// The two confirm dialogs. Both are the same shape -- title, one paragraph
// that says what actually happens, then the actions -- so they are one
// component with the destructive third button as an option.

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, destructive }) {
  return (
    <div className="dialog-backdrop confirm" onClick={onClose}>
      <div
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Clicks inside must not reach the backdrop, which closes.
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-title">{title}</p>
        <p className="dialog-body">{body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep it
          </button>
          {/* Destruction is opt-in and deliberately de-emphasised: the default
              is archive, which keeps the past charges on record. */}
          {destructive && (
            <button type="button" className="btn btn-ghost destructive" onClick={destructive.onClick}>
              {destructive.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
