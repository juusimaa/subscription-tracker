// The application shell: who is signed in, what the server said, and what to
// do when it says something unhelpful.
//
// Dashboard.jsx owns the view; everything below owns the data and the error
// states. The split matters because of one rule from the handoff: a failed
// fetch must never blank the page. The last known good data stays on screen
// with a banner over it saying how old it is, which is only possible if the
// thing holding the data is not the thing that renders the failure.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  archiveSubscription,
  changePassword,
  createCategory,
  createSubscription,
  deleteAccount,
  deleteCategory,
  deleteSubscription,
  exportBackup,
  getCategories,
  getMe,
  getSpend,
  getSubscriptions,
  getToken,
  getUpcoming,
  importBackup,
  logout,
  onAuthExpired,
  renameCategory,
  restoreSubscription,
  unarchiveSubscription,
  updateSubscription,
} from "./api";
import AccountDialog from "./AccountDialog";
import Dashboard from "./dashboard/Dashboard";
import Login from "./Login";
import { MAX_YEAR, MIN_YEAR, ageInWords } from "./format";
import { t } from "./i18n";
import { GitHub, TriangleAlert } from "./icons";
import { useModal } from "./useModal";
import { readPeriod } from "./viewUrl";
import "./modernist.css";
import "./dashboard.css";

const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i);

// The session-expired sign-in, as a dialog over the page it is protecting.
function ReauthDialog({ email, onLogin, onClose }) {
  const ref = useModal(onClose);
  return (
    <div className="dialog-backdrop confirm" onClick={onClose}>
      <div
        ref={ref}
        className="dialog dialog-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={t("app.reauthLabel")}
        onClick={(event) => event.stopPropagation()}
      >
        <Login onLogin={onLogin} email={email} compact />
      </div>
    </div>
  );
}

function App() {
  // Initialised straight from localStorage so a returning user with an
  // unexpired token skips the login screen entirely. The lazy function form
  // means localStorage is read once on mount, not on every render.
  const [token, setToken] = useState(() => getToken());
  const [email, setEmail] = useState(null);
  const [data, setData] = useState(null);
  const [catSpend, setCatSpend] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [staleId, setStaleId] = useState(null);
  const [period, setPeriod] = useState(readPeriod);
  const [accountOpen, setAccountOpen] = useState(false);
  // Only so the banner's "last updated N minutes ago" stays true while it is
  // on screen; nothing else reads it.
  const [, setTick] = useState(0);
  // Read by the 401 handler, which has to know whether there is a rendered
  // page to keep. A ref rather than the state itself so the subscription can
  // be set up once instead of being torn down on every data change.
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const [subscriptions, categories, upcoming, ...spends] = await Promise.all([
        getSubscriptions(),
        getCategories(),
        getUpcoming(30),
        // One request per year in the picker's range. Three requests buys the
        // whole trend strip in both views plus every "change since" figure,
        // and they are the server's real month-by-month totals rather than
        // today's basket scaled by a guess.
        ...YEARS.map((year) => getSpend({ year })),
      ]);
      setData({
        subscriptions,
        categories,
        upcomingTotal: upcoming.total,
        spendByYear: Object.fromEntries(YEARS.map((year, index) => [year, spends[index]])),
      });
      setLoadedAt(Date.now());
      setLoadError(null);
      setDismissed(false);
    } catch (err) {
      // Deliberately does not clear `data`. Everything below the banner keeps
      // rendering the last good answer, which is the whole point of the 500
      // state -- a dashboard that blanks itself on a dropped connection has
      // thrown away the only thing the user came for.
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        // Asked first: a token left in localStorage may well be expired, and
        // finding that out here is cheaper than rendering the app and
        // discovering it from a failed data fetch.
        const me = await getMe();
        setEmail(me.email);
        await load();
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) setLoadError(err);
      }
    })();
  }, [token, load]);

  // A 401 while the page is already rendered is not a reason to throw the
  // page away. The figures are still worth reading and only writes will fail,
  // so it surfaces as a quiet strip; signing in again from there keeps the
  // period, sort and scroll position the user was looking at.
  useEffect(() => { hasData.current = data != null; }, [data]);

  useEffect(
    () =>
      onAuthExpired(() => {
        if (hasData.current) setSessionExpired(true);
        else setToken(null);
      }),
    [],
  );

  // Per-category totals for the selected year, one request each, cached by
  // (year, category). The API has no grouped breakdown for a period
  // (TODO.md D3), and summing the categories in the browser would only be
  // right for the current month. Cancelled plans count too: the server bills
  // them up to the day they stopped, so a category holding only cancelled
  // plans still has real spend in the periods before that (issue #54).
  useEffect(() => {
    if (!data) return undefined;
    const names = [...new Set(data.subscriptions.map((s) => s.category).filter(Boolean))];
    const missing = names.filter((name) => !(`${period.year}|${name}` in catSpend));
    if (missing.length === 0) return undefined;

    let abandoned = false;
    Promise.all(
      missing.map((name) =>
        getSpend({ year: period.year, category: name })
          .then((summary) => [`${period.year}|${name}`, summary])
          // A failed category request leaves that bar at zero rather than
          // taking the page down with it; the headline total is unaffected.
          .catch(() => null),
      ),
    ).then((entries) => {
      if (abandoned) return;
      setCatSpend((current) => ({ ...current, ...Object.fromEntries(entries.filter(Boolean)) }));
    });
    return () => { abandoned = true; };
  }, [data, period.year, catSpend]);

  useEffect(() => {
    if (!loadError) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [loadError]);

  // Every write goes through here: reload on success so the totals can never
  // disagree with the rows, and turn a 404 into the "removed on another
  // device" row rather than a message about a record the user can still see.
  const perform = useCallback(
    async (fn, id) => {
      try {
        const result = await fn();
        setStaleId(null);
        // The category caches are totals; a write can change any of them.
        setCatSpend({});
        await load();
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404 && id != null) setStaleId(id);
        throw err;
      }
    },
    [load],
  );

  const performAll = useCallback(
    (writes) =>
      perform(async () => {
        const results = await Promise.allSettled(writes.map((write) => write()));
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }).catch(async (err) => {
        setCatSpend({});
        await load();
        throw err;
      }),
    [perform, load],
  );

  const actions = useMemo(
    () => ({
      create: (payload) => perform(() => createSubscription(payload)),
      update: (id, patch) => perform(() => updateSubscription(id, patch), id),
      remove: (id) => perform(() => deleteSubscription(id), id),
      archive: (id) => perform(() => archiveSubscription(id), id),
      unarchive: (id) => perform(() => unarchiveSubscription(id), id),
      // "Archive all cancelled" and its undo (issue #67). There is no bulk
      // route, so it is one request per row and one reload at the end. A
      // partial failure still reloads, since the rows that did go through
      // have moved, and then reports the first failure.
      archiveMany: (ids) => performAll(ids.map((id) => () => archiveSubscription(id))),
      unarchiveMany: (ids) => performAll(ids.map((id) => () => unarchiveSubscription(id))),
      restore: (id, payload) => perform(() => restoreSubscription(id, payload), id),
      createCategory: (name) => perform(() => createCategory(name)),
      renameCategory: (id, name) => perform(() => renameCategory(id, name)),
      deleteCategory: (id) => perform(() => deleteCategory(id)),
      // A batch write like any other, so it reloads the same way -- an import
      // can change every figure on the page, and the category caches with
      // them. Export goes out raw: it reads nothing this app is holding and
      // writes nothing, so there is nothing to reload afterwards.
      importBackup: (backup, mode) => perform(() => importBackup(backup, mode)),
      exportBackup,
      refresh: () => { setStaleId(null); return load(); },
    }),
    [perform, performAll, load],
  );

  function handleLogout() {
    logout();
    setToken(null);
    setEmail(null);
    // Drop the previous user's data so it can't flash on screen if someone
    // else logs in on the same browser.
    setData(null);
    setCatSpend({});
    setSessionExpired(false);
    setLoadError(null);
  }

  async function handleReauth(newToken) {
    setToken(newToken);
    setReauthOpen(false);
    setSessionExpired(false);
    await load();
  }

  // Neither of these goes through `perform`: that wrapper reloads the
  // subscription list and rewrites staleId/catSpend, none of which a password
  // or the account itself has anything to do with.
  async function handleChangePassword(current, next) {
    // changePassword() (api.js) already stores the fresh token this device
    // needs to keep working -- the old one is stale the instant the server
    // bumps token_version, which happens as a side effect of this same call.
    await changePassword(current, next);
  }

  async function handleDeleteAccount(password) {
    await deleteAccount(password);
    // The account is gone; there is nothing left to sign out of but this tab.
    handleLogout();
  }

  function handleExportFirst() {
    setAccountOpen(false);
    document.getElementById("io")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The gate: no token, no app.
  if (!token) return <Login onLogin={setToken} />;

  const showBanner = loadError && !dismissed;

  return (
    <>
      <nav className="nav app-nav">
        <span className="nav-brand">
          {t("app.brand")} <span className="tag tag-outline nav-beta-tag">{t("app.beta")}</span>
        </span>
        <a className="nav-link" href="#overview" aria-current="location">{t("app.navOverview")}</a>
        <a className="nav-link" href="#all">{t("app.navAll")}</a>
        {email && (
          <button
            type="button"
            className="btn btn-ghost nav-account"
            aria-label={t("app.accountLabel", { email })}
            onClick={() => setAccountOpen(true)}
          >
            <span className="nav-email">{email}</span>
            <span className="nav-avatar" aria-hidden="true">{email[0]?.toUpperCase()}</span>
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={handleLogout}>{t("app.logout")}</button>
      </nav>

      {/* The banner and the strip stack, banner first: a dead server and a
          lapsed session are different problems and can both be true. */}
      {showBanner && (
        <div role="alert" className="server-banner">
          <div className="server-banner-inner">
            <TriangleAlert size={20} />
            <div>
              <p className="server-banner-title">{t("app.bannerTitle")}</p>
              <p className="server-banner-detail">
                {loadError.message.replace(/[.\s]*$/, ".")}{" "}
                {data
                  ? t("app.bannerStale", { age: ageInWords(loadedAt) })
                  : t("app.bannerNothing")}
              </p>
            </div>
            <button type="button" className="btn btn-secondary" style={{ marginRight: 8 }} onClick={load}>
              {t("app.tryAgain")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: "var(--color-accent-900)" }}
              aria-label={t("app.dismiss")}
              onClick={() => setDismissed(true)}
            >
              {t("app.dismiss")}
            </button>
          </div>
        </div>
      )}

      {sessionExpired && (
        <div role="status" className="session-strip">
          <p>
            {t("app.sessionBefore")}{" "}
            <button type="button" className="link-button" onClick={() => setReauthOpen(true)}>
              {t("app.sessionLink")}
            </button>{" "}
            {t("app.sessionAfter")}
          </p>
        </div>
      )}

      {/* The landmark is here rather than in Dashboard so it exists before
          the first load has finished, and so the banner and session strip
          above it stay outside it, next to the nav they qualify. */}
      <main id="main">
      {data && (
        <Dashboard
          subscriptions={data.subscriptions}
          categories={data.categories}
          spendByYear={data.spendByYear}
          spendByCategory={catSpend}
          upcomingTotal={data.upcomingTotal}
          period={period}
          setPeriod={setPeriod}
          actions={actions}
          staleId={staleId}
        />
      )}
      </main>

      {accountOpen && data && (
        <AccountDialog
          email={email}
          subscriptionCount={data.subscriptions.length}
          categoryCount={data.categories.length}
          onChangePassword={handleChangePassword}
          onDeleteAccount={handleDeleteAccount}
          onExportFirst={handleExportFirst}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {reauthOpen && (
        <ReauthDialog email={email} onLogin={handleReauth} onClose={() => setReauthOpen(false)} />
      )}

      <footer className="app-footer">
        <a
          className="app-footer-link"
          href="https://github.com/juusimaa/subscription-tracker"
          target="_blank"
          rel="noreferrer"
        >
          <GitHub size={16} />
          {t("app.github")}
        </a>
      </footer>
    </>
  );
}

export default App;
