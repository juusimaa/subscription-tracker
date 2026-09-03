// Tracks a CSS media query in JS, for the handful of places a breakpoint
// needs a structural change (table -> list) rather than a restyle -- CSS
// alone can hide and rearrange, but it can't turn a <table> into a <ul>.
// Re-evaluated on the query's own "change" event rather than a window resize
// listener, so this doesn't fire on every pixel of a drag, only when the
// answer actually flips.

import { useEffect, useState } from "react";

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

// The one breakpoint this app uses -- see the note on it in dashboard.css.
const MOBILE_QUERY = "(max-width: 760px)";
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
