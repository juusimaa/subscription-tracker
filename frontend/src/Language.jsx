// The React side of src/i18n.js: the root that owns the language choice and
// the picker that changes it. Kept apart from i18n.js so that file stays
// plain functions any module can import, and this one only components.

import { useEffect, useState } from "react";
import {
  CODES,
  LANGUAGES,
  LanguageContext,
  STORAGE_KEY,
  getLanguage,
  t,
  useCurrentLanguage,
  useLanguage,
} from "./i18n";

export function LanguageRoot({ children }) {
  const [language, setLanguageState] = useState(getLanguage);
  useCurrentLanguage(language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function setLanguage(code) {
    if (!CODES.includes(code)) return;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Remembered for this page view only.
    }
    setLanguageState(code);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children()}
    </LanguageContext.Provider>
  );
}

// The picker itself, used on the sign-in screen and in the Account dialog.
// Two buttons rather than a <select>: with two languages both choices fit,
// and each is one tap. Styled as the app's other segmented controls (.seg).
export function LanguagePicker({ className = "" }) {
  const { language, setLanguage } = useLanguage();
  return (
    <div className={`seg language-picker ${className}`.trim()} role="group" aria-label={t("language.label")}>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          lang={code}
          className="seg-opt"
          aria-pressed={language === code}
          onClick={() => setLanguage(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
