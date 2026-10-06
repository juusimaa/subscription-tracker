// Section 12: the maintenance surface at the foot of the page, and the same
// thing again as a single button under the empty state's add form.
//
// It is deliberately quiet -- no accent fills, no primary button outside the
// confirm dialog -- because it is not what anyone came here to do. What it is
// for is moving a list between environments and building a dataset to test
// against: export, edit the file, read it back.
//
// The file never reaches the server unread. It is parsed here, diffed against
// what is on screen, and shown as a summary the user confirms; only then does
// one batch request go out. That is the design's rule (handoff section 12)
// and it is also the only way the dialog can state what will happen rather
// than guess at it.

import { useRef, useState } from "react";
import { ApiError, describeWriteError } from "../api";
import { BackupFileError, diffBackup, exportFilename, parseBackup } from "../backup";
import { t } from "../i18n";
import { TriangleAlert } from "../icons";
import ImportSummary from "./ImportSummary";
import SectionToggle from "./SectionToggle";

// The drop zone's own limit, checked before the file is read rather than
// after. A backup of a personal subscription list is a few kilobytes; a
// megabyte is already far past anything this app produces, and reading a
// 500 MB file into a string to find that out is the failure mode worth
// avoiding.
const MAX_BYTES = 1024 * 1024;

function ImportExport({ subscriptions, categories, onImport, onExport, variant = "full" }) {
  const [format, setFormat] = useState("json");
  const [mode, setMode] = useState("merge");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Folded until asked for: a backup is something done now and then, and
  // two columns of controls at the foot of every visit is a lot of page for
  // it.
  const [open, setOpen] = useState(false);
  const fileInput = useRef(null);

  const live = subscriptions.filter((s) => s.status !== "cancelled").length;
  const cancelled = subscriptions.length - live;

  // --- export ---

  async function download() {
    setError(null);
    try {
      const text = await onExport(format);
      const filename = exportFilename(format);
      const url = URL.createObjectURL(
        new Blob([text], { type: format === "csv" ? "text/csv" : "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      // Released on the next tick rather than immediately: revoking before
      // the click has been handled cancels the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? describeWriteError(err, t("importExport.nothingExported"))
          : t("importExport.exportFailed"),
      );
    }
  }

  // --- import ---

  // `pasted` picks the wording for data that came from the paste box rather
  // than from a named file.
  function read(text, filename, pasted = false) {
    setWriteError(null);
    try {
      const backup = parseBackup(text, filename);
      if (backup.subscriptions.length === 0) {
        throw new BackupFileError(
          pasted ? t("importExport.pastedEmpty") : t("importExport.fileEmpty", { filename }),
        );
      }
      setError(null);
      setCandidate({
        filename,
        backup,
        diff: diffBackup(backup, subscriptions, categories, mode),
      });
    } catch (err) {
      if (!(err instanceof BackupFileError)) throw err;
      // Nothing was sent, so the file's own problem is the whole message.
      setError(t("importExport.fileProblem", { message: err.message }));
      setCandidate(null);
    }
  }

  async function readFile(file) {
    // Cleared as soon as the file has been handed over, so picking the same
    // path again always fires. An <input type="file"> keeps its value
    // otherwise, and the second pick is silently ignored -- which is exactly
    // the workflow this surface exists for: export, edit that file, read it
    // back, repeat.
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t("importExport.tooLarge", { filename: file.name }));
      setCandidate(null);
      return;
    }
    read(await file.text(), file.name);
  }

  async function confirmImport() {
    setBusy(true);
    setWriteError(null);
    try {
      await onImport(candidate.backup, mode);
      setCandidate(null);
      setPasted("");
      setPasteOpen(false);
    } catch (err) {
      setWriteError(
        err instanceof ApiError
          ? describeWriteError(err, t("importExport.nothingImported"))
          : t("importExport.sendFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  // Switching Merge/Replace with a file already read re-diffs it rather than
  // discarding it: the two modes are two answers about the same file, and
  // making the user choose it again to see the other one is friction for
  // nothing.
  function changeMode(next) {
    setMode(next);
    setCandidate((current) =>
      current
        ? { ...current, diff: diffBackup(current.backup, subscriptions, categories, next) }
        : current,
    );
  }

  const chooseFile = (
    <input
      ref={fileInput}
      type="file"
      accept=".json,.csv,application/json,text/csv"
      hidden
      onChange={(event) => readFile(event.target.files?.[0])}
    />
  );

  const dialog = candidate && (
    <ImportSummary
      filename={candidate.filename}
      diff={candidate.diff}
      busy={busy}
      error={writeError}
      onConfirm={confirmImport}
      onCancel={() => { if (!busy) { setCandidate(null); setWriteError(null); } }}
      onAnotherFile={() => { setCandidate(null); setWriteError(null); fileInput.current?.click(); }}
    />
  );

  const errorLine = error && (
    <div role="alert" className="io-error">
      <TriangleAlert size={16} color="var(--color-accent-900)" />
      <p>{error}</p>
    </div>
  );

  // The empty state's version: one line and one button, under the add form.
  // Export is left out because there is nothing to export yet.
  if (variant === "entry") {
    return (
      <section id="io" className="io-entry" aria-label={t("importExport.importFile")}>
        <p>{t("importExport.entryText")}</p>
        <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
          {t("importExport.importFile")}
        </button>
        {chooseFile}
        {errorLine}
        {dialog}
      </section>
    );
  }

  return (
    <section id="io" className={open ? "io-section" : "io-section folded"} aria-label={t("importExport.sectionLabel")}>
      <div className="section-head">
        <SectionToggle
          title={t("importExport.sectionTitle")}
          open={open}
          onToggle={() => setOpen((current) => !current)}
          controls="io-body"
        />
        <span className="hint">{t("importExport.sectionHint")}</span>
      </div>

      <div id="io-body" className="io-cols" hidden={!open}>
        <div className="io-col io-export">
          <h3>{t("importExport.exportHeading")}</h3>
          <p className="io-body">{t("importExport.exportBody")}</p>
          <div className="io-export-controls">
            <div>
              <span className="field-label">{t("importExport.format")}</span>
              <div className="seg" role="group" aria-label={t("importExport.formatLabel")}>
                {["json", "csv"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="seg-opt"
                    aria-pressed={format === option}
                    onClick={() => setFormat(option)}
                  >
                    {option.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={download}>
              {t("importExport.download")}
            </button>
          </div>
          {/* Derived from the rows on screen, never written down: a stale
              count here would be the one number on the page nobody checks. */}
          <p className="io-meta tnum">
            {t("importExport.meta", {
              filename: exportFilename(format),
              subscriptions: subscriptions.length,
              live,
              cancelled,
              categories: categories.length,
            })}
          </p>
          {/* CSV is the spreadsheet format and cannot hold a category nothing
              is using; saying so here beats letting someone discover it from
              a restore that came back short. */}
          {format === "csv" && (
            <p className="io-meta">{t("importExport.csvNote")}</p>
          )}
        </div>

        <div className="io-col io-import">
          <h3>{t("importExport.importHeading")}</h3>
          <p className="io-body">{t("importExport.importBody")}</p>

          <span className="field-label">{t("importExport.onConflict")}</span>
          <div className="seg" role="group" aria-label={t("importExport.conflictLabel")}>
            <button
              type="button"
              className="seg-opt"
              aria-pressed={mode === "merge"}
              onClick={() => changeMode("merge")}
            >
              {t("importExport.merge")}
            </button>
            <button
              type="button"
              className="seg-opt"
              aria-pressed={mode === "replace"}
              onClick={() => changeMode("replace")}
            >
              {t("importExport.replaceAll")}
            </button>
          </div>
          <p className="io-hint">
            {mode === "merge"
              ? t("importExport.mergeHint")
              : t("importExport.replaceHint")}
          </p>

          {/* A real drop target as well as a picker. onDragOver has to call
              preventDefault or the browser navigates to the dropped file
              instead of handing it over. */}
          <div
            className={`io-drop${dragging ? " dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              readFile(event.dataTransfer.files?.[0]);
            }}
          >
            <div>
              <p className="io-drop-title">{t("importExport.dropTitle")}</p>
              <p className="io-drop-note">{t("importExport.dropNote")}</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileInput.current?.click()}
            >
              {t("importExport.chooseFile")}
            </button>
          </div>
          {chooseFile}

          <button
            type="button"
            className="btn btn-ghost btn-small io-paste-toggle"
            onClick={() => setPasteOpen((open) => !open)}
          >
            {pasteOpen ? t("importExport.hidePaste") : t("importExport.showPaste")}
          </button>
          {pasteOpen && (
            <div className="io-paste">
              <textarea
                className="input"
                rows={5}
                aria-label={t("importExport.pasteLabel")}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!pasted.trim()}
                onClick={() => read(pasted, t("importExport.pastedData"), true)}
              >
                {t("importExport.readPasted")}
              </button>
            </div>
          )}

          {errorLine}
        </div>
      </div>

      {dialog}
    </section>
  );
}

export default ImportExport;
