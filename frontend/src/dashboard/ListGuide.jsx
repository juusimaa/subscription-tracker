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
import { money, statusLabel } from "../format";
import { t } from "../i18n";

// Built at render time, so a switch of language reaches every line.
const terms = () => [
  { term: <span className="tag tag-neutral">{statusLabel("active")}</span>, text: t("listGuide.active") },
  { term: <span className="tag tag-neutral">{t("table.scheduled")}</span>, text: t("listGuide.scheduled") },
  { term: <span className="tag tag-accent">{statusLabel("trial")}</span>, text: t("listGuide.trial") },
  { term: <span className="tag tag-outline">{statusLabel("paused")}</span>, text: t("listGuide.paused") },
  { term: <span className="tag tag-outline">{statusLabel("cancelled")}</span>, text: t("listGuide.cancelled") },
  { term: <span className="guide-term">{t("listGuide.ended")}</span>, text: t("listGuide.endedText") },
  { term: <span className="tag tag-outline">{statusLabel("archived")}</span>, text: t("listGuide.archived") },
  { term: <span className="guide-term">{t("table.earlierRun")}</span>, text: t("listGuide.earlierRun") },
  { term: <span className="guide-term">{t("table.col.paid")}</span>, text: t("listGuide.paid", { zero: money(0) }) },
  // Currencies (PLAN.md milestone 10): what "≈" means, and why a
  // subscription's currency cannot be edited.
  { term: <span className="guide-term">≈</span>, text: t("listGuide.approx") },
  { term: <span className="guide-term">{t("fx.currency")}</span>, text: t("fx.locked") },
];

const shortcuts = () => [
  { keys: ["/"], text: t("listGuide.key.search") },
  { keys: ["N"], text: t("listGuide.key.add") },
  { keys: ["Enter"], text: t("listGuide.key.save") },
  { keys: ["Esc"], text: t("listGuide.key.close") },
];

function ListGuide() {
  const [open, setOpen] = useState(false);
  // The keys only mean something where there is a keyboard to press them.
  const isMobile = useIsMobile();
  return (
    <section aria-label={t("listGuide.title")} className={open ? "guide-section" : "guide-section folded"}>
      <div className="section-head">
        <SectionToggle
          title={t("listGuide.title")}
          open={open}
          onToggle={() => setOpen((value) => !value)}
          controls="guide-body"
        />
        <span className="hint">{t("listGuide.hint")}</span>
      </div>
      <div id="guide-body" className="section-body guide-body" hidden={!open}>
        <dl className="guide-terms">
          {terms().map(({ term, text }, index) => (
            <div key={index} className="guide-row">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        {!isMobile && (
          <dl className="guide-keys" aria-label={t("listGuide.keysLabel")}>
            {shortcuts().map(({ keys, text }) => (
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
