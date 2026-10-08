// What every dialog and sheet in this app owes a keyboard or screen-reader
// user, in one place: focus moves into the dialog when it opens, Tab and
// Shift+Tab stay inside it, Escape closes it, and focus goes back to whatever
// opened it once it is gone.
//
// Not the native <dialog> element: every dialog here is already a
// .dialog-backdrop / .dialog pair that dashboard.css re-chromes into a bottom
// sheet below 760px, and moving them into the top layer would change both
// the stacking (the categories dialog nests a confirm inside itself) and the
// visual baselines, for behaviour this hook gives them as they are.
//
// Dialogs can stack, so only the topmost one answers Escape and traps Tab --
// a confirm opened over the categories dialog closes on its own, leaving the
// one underneath where it was.
//
// While any dialog is open the page underneath does not scroll (issue #114):
// on a phone a swipe on a sheet too short to scroll, or on the dimmed
// backdrop above it, otherwise moved the dashboard instead.

import { useEffect, useLayoutEffect, useRef } from "react";

const stack = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// overflow: hidden on <html> rather than the position: fixed body trick: it
// keeps the sticky nav where it is behind the backdrop and needs no scroll
// position restoring, and Safari has honoured it since iOS 16. When the page
// has a classic scrollbar its gutter stays reserved, so desktop layout does
// not shift as the scrollbar goes; a page without one is left alone.
let unlock = null;

function lockPageScroll() {
  const root = document.documentElement;
  const { overflow, scrollbarGutter } = root.style;
  if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = "stable";
  root.style.overflow = "hidden";
  return () => {
    root.style.overflow = overflow;
    root.style.scrollbarGutter = scrollbarGutter;
  };
}

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

// `onClose` may be undefined while the dialog must not be dismissed (an
// import being written, say): Escape then does nothing, as the backdrop does.
export function useModal(onClose) {
  const ref = useRef(null);
  // The latest onClose, without re-running the open/close effect below every
  // time a parent passes a fresh arrow function.
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    if (stack.length === 0) unlock = lockPageScroll();
    stack.push(dialog);

    // The dialog itself takes focus rather than its first control. Its label
    // is what a screen reader should announce first, and on a phone a
    // focused input would throw up the keyboard over a sheet the user only
    // opened to read. A dialog that does want a field focused marks it.
    const initial = dialog.querySelector("[data-autofocus]");
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    (initial || dialog).focus({ preventScroll: true });

    function onKeyDown(event) {
      if (stack[stack.length - 1] !== dialog) return;
      // A control that handles Escape itself (the categories dialog's rename
      // field backs out of the rename) marks the event as used.
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (close.current) {
          event.preventDefault();
          close.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      stack.splice(stack.indexOf(dialog), 1);
      if (stack.length === 0 && unlock) {
        unlock();
        unlock = null;
      }
      // The opener can be gone by now (a row menu item unmounts with its
      // menu); there is nothing sensible to return to then, so focus is left
      // where the browser puts it.
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return ref;
}
