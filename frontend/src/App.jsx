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
  createCategory,
  createSubscription,
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
  updateSubscription,
} from "./api";
import Dashboard from "./dashboard/Dashboard";
import Login from "./Login";
import { MAX_YEAR, MIN_YEAR, ageInWords } from "./format";
import { TriangleAlert } from "./icons";
import "./modernist.css";
import "./dashboard.css";

const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i);

// The period the page opens on: this month, or the nearest end of the range
// if today falls outside it. Clamping rather than showing an empty period
// keeps the first render meaningful even in 2028.
function initialPeriod() {
  const now = new Date();
  const year = Math.min(MAX_YEAR, Math.max(MIN_YEAR, now.getFullYear()));
  return { view: "monthly", year, month: year === now.getFullYear() ? now.getMonth() : 0 };
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
  const [period, setPeriod] = useState(initialPeriod);
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
  // right for the current month.
  useEffect(() => {
    if (!data) return undefined;
    const names = [
      ...new Set(
        data.subscriptions.filter((s) => s.status !== "cancelled").map((s) => s.category).filter(Boolean),
      ),
    ];
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

  const actions = useMemo(
    () => ({
      create: (payload) => perform(() => createSubscription(payload)),
      update: (id, patch) => perform(() => updateSubscription(id, patch), id),
      remove: (id) => perform(() => deleteSubscription(id), id),
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
    [perform, load],
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

  // The gate: no token, no app.
  if (!token) return <Login onLogin={setToken} />;

  const showBanner = loadError && !dismissed;

  return (
    <>
      <nav className="nav app-nav">
        <span className="nav-brand">Subscriptions</span>
        <a className="nav-link" href="#overview" aria-current="location">Overview</a>
        <a className="nav-link" href="#all">All subscriptions</a>
        {email && <span className="nav-email">{email}</span>}
        <button type="button" className="btn btn-secondary" onClick={handleLogout}>Log out</button>
      </nav>

      {/* The banner and the strip stack, banner first: a dead server and a
          lapsed session are different problems and can both be true. */}
      {showBanner && (
        <div role="alert" className="server-banner">
          <div className="server-banner-inner">
            <TriangleAlert size={20} />
            <div>
              <p className="server-banner-title">Couldn&apos;t load your subscriptions</p>
              <p className="server-banner-detail">
                {loadError.status
                  ? `${loadError.status} — the server didn't respond.`
                  : "The server could not be reached."}{" "}
                {data
                  ? `Figures below were last updated ${ageInWords(loadedAt)}.`
                  : "Nothing has loaded yet."}
              </p>
            </div>
            <button type="button" className="btn btn-secondary" style={{ marginRight: 8 }} onClick={load}>
              Try again
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: "var(--color-accent-900)" }}
              aria-label="Dismiss"
              onClick={() => setDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {sessionExpired && (
        <div role="status" className="session-strip">
          <p>
            Your session expired —{" "}
            <button type="button" className="link-button" onClick={() => setReauthOpen(true)}>
              sign in again
            </button>{" "}
            to keep editing. 401 from the server.
          </p>
        </div>
      )}

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

      {reauthOpen && (
        <div className="dialog-backdrop confirm" onClick={() => setReauthOpen(false)}>
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Sign in again"
            onClick={(event) => event.stopPropagation()}
          >
            <Login onLogin={handleReauth} email={email} compact />
          </div>
        </div>
      )}
    </>
  );
}

export default App;
