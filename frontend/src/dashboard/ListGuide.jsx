// What the list's words mean, folded under the list that uses them. The
// statuses, "ended" against "archived", and an "earlier run" are this app's
// own vocabulary, and nothing else on the page defines them for someone who
// arrived without the history. Folded by default: a returning user already
// knows, and a stranger finds it right where the words appear.
//
// Each term is set the way the list sets it -- the same tag, or the same
// button label -- so the reader can match what they see to what it means.

import { useState } from "react";
import { useIsMobile } from "../useMediaQuery";
import SectionToggle from "./SectionToggle";

const TERMS = [
  {
    term: <span className="tag tag-neutral">Active</span>,
    text: "Charges on its next renewal and counts in every total.",
  },
  {
    term: <span className="tag tag-neutral">Scheduled</span>,
    text: "Active, with a start date still ahead. It counts from its first charge.",
  },
  {
    term: <span className="tag tag-accent">Trial</span>,
    text:
      "Free until the day it converts. It is left out of the totals until then; the price shown is what it costs if you keep it.",
  },
  {
    term: <span className="tag tag-outline">Paused</span>,
    text: "Kept in the list, and left out of the totals while it is paused.",
  },
  {
    term: <span className="tag tag-outline">Cancelled</span>,
    text:
      "Marked as cancelled here, which does not cancel it with the provider. It stays in the list until the time already paid for runs out.",
  },
  {
    term: <span className="guide-term">Ended</span>,
    text:
      "A cancelled plan whose paid time is over. It leaves the list until you choose Show ended, and its past charges still count in the months they were billed.",
  },
  {
    term: <span className="tag tag-outline">Archived</span>,
    text:
      "A cancelled plan you have put away with Archive in its More menu. Nothing is deleted: it stays in every total and in backups, and Show archived brings it back.",
  },
  {
    term: <span className="guide-term">Earlier run</span>,
    text:
      "Reactivating a cancelled plan starts a new run. The earlier ones fold under the current one, so a service's whole history stays in one row.",
  },
  {
    term: <span className="guide-term">Paid to date</span>,
    text:
      "Everything a service has charged, from its first charge up to today, counted the same way as your totals. It includes every run, and a trial or a plan that hasn't started is €0.00 until it charges.",
  },
];

const KEYS = [
  { keys: ["/"], text: "Search the list" },
  { keys: ["N"], text: "Add a subscription" },
  { keys: ["Enter"], text: "Save the row you are editing" },
  { keys: ["Esc"], text: "Close a dialog or menu" },
];

function ListGuide() {
  const [open, setOpen] = useState(false);
  // The keys only mean something where there is a keyboard to press them.
  const isMobile = useIsMobile();
  return (
    <section aria-label="How this list works" className={open ? "guide-section" : "guide-section folded"}>
      <div className="section-head">
        <SectionToggle
          title="How this list works"
          open={open}
          onToggle={() => setOpen((value) => !value)}
          controls="guide-body"
        />
        <span className="hint">What the statuses mean, and the keyboard shortcuts</span>
      </div>
      <div id="guide-body" className="section-body guide-body" hidden={!open}>
        <dl className="guide-terms">
          {TERMS.map(({ term, text }, index) => (
            <div key={index} className="guide-row">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        {!isMobile && (
          <dl className="guide-keys" aria-label="Keyboard shortcuts">
            {KEYS.map(({ keys, text }) => (
              <div key={text} className="guide-key">
                <dt>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

export default ListGuide;
