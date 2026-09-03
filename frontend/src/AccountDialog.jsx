// The Account dialog, opened from the signed-in email in the header
// (handoff section 13) and, at narrow widths, the same content re-chromed as
// a bottom sheet (section 14) rather than a second component -- the mobile
// design changes only the container (centered box vs. bottom sheet, larger
// tap targets), never the copy or the fields, so one component covers both
// and dashboard.css switches the chrome at the ~760px breakpoint the handoff
// suggests. See the comment on .account-backdrop there.
//
// Two things here go beyond what the handoff's own generic API contract
// (`DELETE /account`) asked for, both deliberate:
// - Delete asks for the password a second time, even though the confirm
//   dialog's own mock only shows the typed "DELETE". A Bearer token alone
//   proves there is a session, not that whoever is holding it right now is
//   the account owner, and this action cannot be undone.
// - The "signs you out on other devices" line is literally true here: the
//   backend bumps a token_version on password change and rejects any token
//   minted before it (see auth.get_current_user), so this isn't aspirational
//   copy.

import { useState } from "react";
import { ApiError } from "./api";
import { TriangleAlert } from "./icons";

function stop(event) {
  event.stopPropagation();
}

function AccountDialog({
  email,
  subscriptionCount,
  categoryCount,
  onChangePassword,
  onDeleteAccount,
  onExportFirst,
  onClose,
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [pwError, setPwError] = useState(null);
  const [pwDone, setPwDone] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  function closeDelete() {
    setDeleteOpen(false);
    setDeletePassword("");
    setConfirmText("");
    setDeleteError(null);
  }

  async function submitPassword() {
    // Client-side first, same rule the field errors on the add form follow:
    // a request is only worth sending once the obvious mistakes are ruled
    // out. Only the mismatch has copy of its own in the handoff; the other
    // two are this component's own guard in front of the same server rule
    // (PasswordChange.new_password, min 8 -- matching what /register already
    // asks for, not the mock's unrelated "10").
    if (!currentPassword) {
      setPwError("Enter your current password.");
      setPwDone(false);
      return;
    }
    if (newPassword !== repeatPassword) {
      setPwError("The two new passwords don't match. 400 — nothing was changed.");
      setPwDone(false);
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      setPwDone(false);
      return;
    }
    setPwSaving(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setPwError(null);
      setPwDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (err) {
      setPwDone(false);
      setPwError(err instanceof ApiError ? `${err.message} (${err.status})` : err.message);
    } finally {
      setPwSaving(false);
    }
  }

  const deleteBlocked =
    deleteSaving || !deletePassword || confirmText.trim().toUpperCase() !== "DELETE";

  async function submitDelete() {
    if (deleteBlocked) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await onDeleteAccount(deletePassword);
      // No further state to reset: onDeleteAccount succeeding means the App
      // shell is about to unmount this dialog by logging the user out.
    } catch (err) {
      setDeleteError(err instanceof ApiError ? `${err.message} (${err.status})` : err.message);
    } finally {
      setDeleteSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop account-backdrop" onClick={onClose}>
      <div
        className="dialog dialog-account"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={stop}
      >
        <div className="dialog-head">
          <p className="dialog-title" id="account-title">Account</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="account-identity">
          <span className="field-label">Signed in as</span>
          <span className="account-email">{email}</span>
        </div>

        <div className="account-section">
          <h3 className="account-heading">Change password</h3>
          <p className="account-explainer">
            At least 8 characters. Changing it signs you out on other devices — your
            subscriptions are untouched.
          </p>
          <div className="account-pw-grid">
            <label className="field account-pw-current">
              <span className="field-label">Current password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">New password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Repeat new password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
              />
            </label>
          </div>
          {pwError && (
            <p role="alert" className="dialog-error">
              <TriangleAlert size={16} />
              <span>{pwError}</span>
            </p>
          )}
          <div className="account-pw-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pwSaving}
              onClick={submitPassword}
            >
              Update password
            </button>
            {pwDone && (
              <span role="status" className="account-pw-done">
                Password updated — other devices signed out.
              </span>
            )}
          </div>
        </div>

        <div className="account-section account-danger">
          <h3 className="account-heading">Delete account</h3>
          <p className="account-explainer">
            Removes your login and all {subscriptionCount} subscription
            {subscriptionCount === 1 ? "" : "s"}, including cancelled and archived ones, with
            their charge history. This cannot be undone — export your data first if you want a
            copy.
          </p>
          <div className="account-danger-actions">
            <button type="button" className="btn btn-secondary" onClick={onExportFirst}>
              Export first
            </button>
            {/* Destructive on purpose as a ghost button: reachable, never the
                visual default. */}
            <button
              type="button"
              className="btn btn-ghost account-delete-trigger"
              onClick={() => setDeleteOpen(true)}
            >
              Delete my account
            </button>
          </div>
        </div>
      </div>

      {deleteOpen && (
        <div className="dialog-backdrop confirm account-backdrop" onClick={(e) => { stop(e); closeDelete(); }}>
          <div
            className="dialog dialog-confirm dialog-account-delete"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-delete-title"
            onClick={stop}
          >
            <p className="dialog-title" id="account-delete-title">Delete {email}?</p>
            <p className="dialog-body">
              {subscriptionCount} subscription{subscriptionCount === 1 ? "" : "s"},{" "}
              {categoryCount} categor{categoryCount === 1 ? "y" : "ies"} and your login are
              removed. Everything goes at once and nothing can be restored afterwards.
            </p>
            <label className="field account-delete-field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            <label className="field account-delete-field">
              <span className="field-label">Type DELETE to confirm</span>
              <input
                className="input"
                type="text"
                placeholder="DELETE"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </label>
            {deleteError && (
              <p role="alert" className="dialog-error">
                <TriangleAlert size={16} />
                <span>{deleteError}</span>
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={deleteBlocked}
                onClick={submitDelete}
              >
                Delete account
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeDelete}>
                Keep my account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountDialog;
