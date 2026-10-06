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
import { describeWriteError, resendVerification } from "./api";
import { longDate } from "./format";
import { CURRENCIES, currencyName, inCurrency } from "./fx";
import { t } from "./i18n";
import { LanguagePicker } from "./Language";
import { TriangleAlert } from "./icons";
import { useModal } from "./useModal";

function stop(event) {
  event.stopPropagation();
}

// The currency every total is shown in, and that new subscriptions start in
// (PLAN.md milestone 10). Saved on change, like the language, with one plain
// status line under it. Changing it reloads the page's figures; no
// subscription changes.
function CurrencySection({ currency, onChange, rates, usesForeign }) {
  const [save, setSave] = useState({ state: "idle", message: null });

  async function choose(event) {
    const code = event.target.value;
    setSave({ state: "saving", message: null });
    try {
      await onChange(code);
      setSave({ state: "saved", message: t("account.currencySaved", { shownIn: inCurrency(code) }) });
    } catch (err) {
      setSave({ state: "error", message: describeWriteError(err) });
    }
  }

  const asOf = rates?.as_of;
  const ratesNote = !usesForeign || !asOf
    ? t("account.ratesNoteNone")
    : rates.stale
      ? t("account.ratesNoteStale", { date: longDate(asOf) })
      : t("account.ratesNote", { date: longDate(asOf) });

  return (
    <div className="account-section account-currency">
      <h3 className="account-heading" id="account-currency-heading">{t("account.currency")}</h3>
      <p className="account-explainer">{t("account.currencyNote")}</p>
      <select
        className="input currency-select"
        aria-labelledby="account-currency-heading"
        value={currency}
        disabled={save.state === "saving"}
        onChange={choose}
      >
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>{`${code} — ${currencyName(code)}`}</option>
        ))}
      </select>
      <p role="status" className="account-saved">
        {save.state === "error" ? (
          <span className="field-error">{save.message}</span>
        ) : (
          save.message
        )}
      </p>
      <p className="fx-note">{ratesNote}</p>
    </div>
  );
}

// The delete confirm opens over the account dialog, so it needs its own place
// on the modal stack -- Escape closes it and leaves the account dialog open.
// `onClose` is withheld while the delete is in flight.
function DeletePanel({ onClose, children, ...props }) {
  const ref = useModal(onClose);
  return <div ref={ref} {...props}>{children}</div>;
}

// Whether the address is confirmed, under the address itself (PLAN.md
// milestone 9). This is the status's permanent home: the nudge under the
// header can be dismissed, and this can't.
function EmailStatus({ verified }) {
  const [send, setSend] = useState({ state: "idle", error: null });
  if (verified === undefined) return null;
  if (verified) return <span className="account-email-status">{t("account.emailConfirmed")}</span>;

  async function sendLink() {
    setSend({ state: "sending", error: null });
    try {
      await resendVerification();
      setSend({ state: "sent", error: null });
    } catch (err) {
      setSend({ state: "error", error: describeWriteError(err, t("verify.nothingSent")) });
    }
  }

  return (
    <span role="status" className="account-email-status">
      {send.state === "sent" ? (
        t("account.confirmSent")
      ) : (
        <>
          {t("account.emailUnconfirmed")}{" "}
          <button
            type="button"
            className="link-button"
            disabled={send.state === "sending"}
            onClick={sendLink}
          >
            {t("account.sendConfirm")}
          </button>
          {send.error && <> {send.error}</>}
        </>
      )}
    </span>
  );
}

function AccountDialog({
  email,
  emailVerified,
  subscriptionCount,
  categoryCount,
  currency,
  onChangeCurrency,
  rates,
  usesForeign,
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
  const ref = useModal(deleteSaving ? undefined : onClose);

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
      setPwError(t("account.needCurrent"));
      setPwDone(false);
      return;
    }
    if (newPassword !== repeatPassword) {
      setPwError(t("account.mismatch"));
      setPwDone(false);
      return;
    }
    if (newPassword.length < 8) {
      setPwError(t("account.tooShort"));
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
      setPwError(describeWriteError(err, t("api.nothingChanged")));
    } finally {
      setPwSaving(false);
    }
  }

  // "DELETE" in English, "POISTA" in Finnish: the word is the reader's own.
  const confirmWord = t("account.confirmWord");
  const deleteBlocked =
    deleteSaving || !deletePassword || confirmText.trim().toUpperCase() !== confirmWord;

  async function submitDelete() {
    if (deleteBlocked) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await onDeleteAccount(deletePassword);
      // No further state to reset: onDeleteAccount succeeding means the App
      // shell is about to unmount this dialog by logging the user out.
    } catch (err) {
      setDeleteError(describeWriteError(err, t("api.nothingChanged")));
    } finally {
      setDeleteSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop account-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog dialog-account"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={stop}
      >
        <div className="dialog-head">
          <p className="dialog-title" id="account-title">{t("account.title")}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            {t("account.close")}
          </button>
        </div>

        <div className="account-identity">
          <span className="field-label">{t("account.signedInAs")}</span>
          <span className="account-email">{email}</span>
          <EmailStatus verified={emailVerified} />
        </div>

        <div className="account-section account-language">
          <h3 className="account-heading">{t("language.label")}</h3>
          <p className="account-explainer">{t("account.languageNote")}</p>
          <LanguagePicker />
        </div>

        <CurrencySection
          currency={currency}
          onChange={onChangeCurrency}
          rates={rates}
          usesForeign={usesForeign}
        />

        <div className="account-section">
          <h3 className="account-heading">{t("account.changePassword")}</h3>
          <p className="account-explainer">{t("account.passwordNote")}</p>
          <div className="account-pw-grid">
            <label className="field account-pw-current">
              <span className="field-label">{t("account.currentPassword")}</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("account.newPassword")}</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("account.repeatPassword")}</span>
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
              {t("account.updatePassword")}
            </button>
            {pwDone && (
              <span role="status" className="account-pw-done">
                {t("account.passwordDone")}
              </span>
            )}
          </div>
        </div>

        <div className="account-section account-danger">
          <h3 className="account-heading">{t("account.deleteHeading")}</h3>
          <p className="account-explainer">{t("account.deleteNote", { n: subscriptionCount })}</p>
          <div className="account-danger-actions">
            <button type="button" className="btn btn-secondary" onClick={onExportFirst}>
              {t("account.exportFirst")}
            </button>
            {/* Destructive on purpose as a ghost button: reachable, never the
                visual default. */}
            <button
              type="button"
              className="btn btn-ghost account-delete-trigger"
              onClick={() => setDeleteOpen(true)}
            >
              {t("account.deleteMine")}
            </button>
          </div>
        </div>
      </div>

      {deleteOpen && (
        <div className="dialog-backdrop confirm account-backdrop" onClick={(e) => { stop(e); closeDelete(); }}>
          <DeletePanel
            onClose={deleteSaving ? undefined : closeDelete}
            className="dialog dialog-confirm dialog-account-delete"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-delete-title"
            onClick={stop}
          >
            <p className="dialog-title" id="account-delete-title">
              {t("account.deleteTitle", { email })}
            </p>
            <p className="dialog-body">
              {t("account.deleteBody", { subscriptions: subscriptionCount, categories: categoryCount })}
            </p>
            <label className="field account-delete-field">
              <span className="field-label">{t("login.password")}</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            <label className="field account-delete-field">
              <span className="field-label">{t("account.confirmLabel", { word: confirmWord })}</span>
              <input
                className="input"
                type="text"
                placeholder={confirmWord}
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
                {t("account.deleteConfirm")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeDelete}>
                {t("account.keep")}
              </button>
            </div>
          </DeletePanel>
        </div>
      )}
    </div>
  );
}

export default AccountDialog;
