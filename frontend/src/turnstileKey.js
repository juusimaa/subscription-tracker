// Cloudflare Turnstile's public site key (Turnstile.jsx): from config.js in a
// deployed container (the TURNSTILE_SITE_KEY env var, rendered the same way
// as API_URL), or Vite's VITE_TURNSTILE_SITE_KEY in dev. Empty switches the
// bot check off on every form.
export const TURNSTILE_SITE_KEY =
  window.__TURNSTILE_SITE_KEY__ || import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
