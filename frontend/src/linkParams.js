// The tokens an emailed link carries (PLAN.md milestone 9): ?verify= from a
// confirmation email, ?reset= from a password-reset one. The backend builds
// both links (backend/app/mailer.py).
//
// Read once, when this module is first imported, and removed from the
// address bar straight away: a token left in the URL would sit in history,
// get copied along with a shared dashboard link, and be submitted again on
// every reload. Module scope rather than a hook so React's StrictMode double
// render can't read the URL a second time after it has been cleaned.

function take() {
  let url;
  try {
    url = new URL(window.location.href);
  } catch {
    return {};
  }
  const verify = url.searchParams.get("verify");
  const reset = url.searchParams.get("reset");
  if (!verify && !reset) return {};
  url.searchParams.delete("verify");
  url.searchParams.delete("reset");
  window.history.replaceState(window.history.state, "", url);
  return { verify: verify || null, reset: reset || null };
}

export const linkParams = take();
