// Cloudflare Turnstile, the bot check on signing up and on asking for a
// password reset: the two forms that make the backend email an address
// nobody has proven yet (backend/app/turnstile.py).
//
// Switched on by a site key (turnstileKey.js). Without one this renders
// nothing, the forms send no token, and a backend with no secret of its own
// doesn't ask for one.
//
// A token is good for one check. The form remounts this (a new `key`) after
// each attempt, so a refused submit gets a fresh one.

import { useEffect, useRef } from "react";
import { getLanguage } from "./i18n";
import { TURNSTILE_SITE_KEY } from "./turnstileKey";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// One script load for the page, however many times a form mounts the widget.
let scriptLoad = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

// `onToken` gets the token once the check passes, and null when it expires
// or fails, so the form can hold its submit until there is one. `action`
// names the form; the backend refuses a token solved for another one.
function Turnstile({ action, onToken }) {
  const box = useRef(null);
  // The latest callback without re-rendering the widget when it changes.
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return undefined;
    let widget = null;
    let cancelled = false;
    loadScript()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        widget = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          language: getLanguage(),
          theme: "auto",
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget !== null) window.turnstile?.remove(widget);
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="turnstile" />;
}

export default Turnstile;
