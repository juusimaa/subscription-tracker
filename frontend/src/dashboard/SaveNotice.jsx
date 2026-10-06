// The quiet line that says a write went through (issue #63). Failures
// already say so where they happened; this is the same idea for success,
// because a row that moves to another sort position, or out of view into the
// ended list, otherwise leaves no sign the save happened at all.
//
// Not a toast (DESIGN.md): it sits in the page flow next to what changed and
// stays until the next write replaces it. The live region is always mounted,
// empty when there is nothing to say, so a screen reader hears the first
// message too -- a region inserted together with its text is often missed.

// The message and the action's label may be functions: the dashboard passes
// them that way so a notice still on screen follows a change of language.
const text = (value) => (typeof value === "function" ? value() : value);

function SaveNotice({ notice }) {
  return (
    <p role="status" className="save-notice">
      {notice && (
        // Keyed by the write, so the same sentence twice in a row ("Netflix
        // saved." after two edits) is new content and is announced again.
        <span key={notice.seq}>
          {text(notice.message)}
          {notice.action && (
            <>
              {" "}
              <button type="button" className="link-button" onClick={notice.action.run}>
                {text(notice.action.label)}
              </button>
            </>
          )}
        </span>
      )}
    </p>
  );
}

export default SaveNotice;
