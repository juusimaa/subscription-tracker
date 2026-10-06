// The interface language: English or Finnish (issue #89).
//
// No i18n library. Two languages and a few hundred strings do not need one,
// and every message that has to agree with a number -- "1 subscription",
// "3 tilausta", a month name in the inessive -- is easier to get right as a
// small function than as a plural-rule mini-language.
//
// How it fits together:
// - Each area of the app keeps its messages in src/locales/<area>.js as
//   { en: {...}, fi: {...} }. A message is a string with {name} placeholders,
//   or a function of the same vars object for anything plural or inflected.
// - `t(key, vars)` reads the current language from module state, so plain
//   helpers (format.js, api.js, backup.js) can translate without a hook.
// - <LanguageRoot> (Language.jsx) owns the choice as React state and
//   re-renders the whole tree when it changes. Nothing in the app is memoised with React.memo, so
//   a re-render from the top reaches every string on the page without
//   remounting it -- the period, the sort and an open dialog all survive a
//   switch of language.
//
// The default is the browser's own preference (navigator.languages); once
// someone picks a language it is remembered in this browser.

import { createContext, useContext } from "react";
import messages from "./locales";

export const LANGUAGES = [
  // Each named in its own language: someone who cannot read the current one
  // still has to be able to find theirs.
  { code: "en", label: "English" },
  { code: "fi", label: "Suomi" },
];
export const CODES = LANGUAGES.map((language) => language.code);
export const STORAGE_KEY = "language";

// localStorage can throw (private mode, blocked site data); a failure there
// only costs the remembered choice, never the page.
function stored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return CODES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

// The first of the browser's preferred languages that this app speaks, by
// primary subtag ("fi-FI" -> "fi"). English when none of them is one.
export function detectLanguage(preferred = navigator.languages ?? [navigator.language]) {
  for (const tag of preferred) {
    const code = String(tag || "").toLowerCase().split("-")[0];
    if (CODES.includes(code)) return code;
  }
  return "en";
}

let current = stored() ?? detectLanguage();

export const getLanguage = () => current;

// Called by <LanguageRoot> during render, not in an effect, so the very
// render that follows a switch already reads the new language everywhere
// `t` is called.
export function useCurrentLanguage(code) {
  current = code;
}

// BCP 47 tag for Intl and toLocaleString.
export const getLocaleTag = () => (current === "fi" ? "fi-FI" : "en-US");

export function t(key, vars = {}) {
  const message = messages[current]?.[key] ?? messages.en[key];
  if (message == null) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing message: ${key}`);
    return key;
  }
  if (typeof message === "function") return message(vars);
  if (Array.isArray(message)) return message;
  return message.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

// For text that arrives already written in English (the server's error
// details): the current language's message for `key` if it has one, else the
// original text untouched.
export function translateOr(key, fallback) {
  return current === "en" || messages[current]?.[key] == null ? fallback : t(key);
}

export const LanguageContext = createContext({ language: current, setLanguage: () => {} });

export const useLanguage = () => useContext(LanguageContext);
