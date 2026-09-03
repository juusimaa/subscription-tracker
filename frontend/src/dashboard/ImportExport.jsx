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
import { ApiError } from "../api";
import { BackupFileError, diffBackup, exportFilename, parseBackup } from "../backup";
import { TriangleAlert } from "../icons";
import ImportSummary from "./ImportSummary";

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
          ? `${err.message} ${err.status} — nothing was exported.`
          : "The export could not be built.",
      );
    }
  }

  // --- import ---

  function read(text, filename) {
    setWriteError(null);
    try {
      const backup = parseBackup(text, filename);
      if (backup.subscriptions.length === 0) {
        throw new BackupFileError(`${filename} has no subscriptions in it.`);
      }
      setError(null);
      setCandidate({
        filename,
        backup,
        diff: diffBackup(backup, subscriptions, categories, mode),
      });
    } catch (err) {
      if (!(err instanceof BackupFileError)) throw err;
      // No status code in the copy: nothing was sent, so there is no code to
      // report. The design's 422 wording assumes the server did the checking;
      // claiming one the server never returned would be a lie in the one
      // message the user is meant to act on. A rejection from the write
      // itself does carry its real code -- see the dialog.
      setError(`${err.message} Nothing was imported.`);
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
      setError(`${file.name} is larger than 1 MB. Nothing was imported.`);
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
          ? `${err.message} ${err.status} — nothing was imported.`
          : "The import could not be sent. Nothing was imported.",
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
      <section id="io" className="io-entry" aria-label="Import a file">
        <p>
          Already have a list somewhere? Bring in a JSON or CSV export instead of typing it out.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
          Import a file
        </button>
        {chooseFile}
        {errorLine}
        {dialog}
      </section>
    );
  }

  return (
    <section id="io" className="io-section" aria-label="Import and export">
      <div className="section-head">
        <span className="eyebrow">Import &amp; export</span>
        <span className="hint">Maintenance — moving your list in and out in one go</span>
      </div>

      <div className="io-cols">
        <div className="io-col io-export">
          <h3>Export</h3>
          <p className="io-body">
            Everything on this page in one file — subscriptions, categories, cycles, statuses and
            renewal dates. Re-import it later to get exactly this state back.
          </p>
          <div className="io-export-controls">
            <div>
              <span className="field-label">Format</span>
              <div className="seg" role="group" aria-label="Export format">
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
              Download export
            </button>
          </div>
          {/* Derived from the rows on screen, never written down: a stale
              count here would be the one number on the page nobody checks. */}
          <p className="io-meta tnum">
            {exportFilename(format)} · {subscriptions.length} subscription
            {subscriptions.length === 1 ? "" : "s"} ({live} live, {cancelled} cancelled) ·{" "}
            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
          </p>
          {/* CSV is the spreadsheet format and cannot hold a category nothing
              is using; saying so here beats letting someone discover it from
              a restore that came back short. */}
          {format === "csv" && (
            <p className="io-meta">
              CSV carries one row per subscription, so categories nothing uses are left out. JSON
              restores exactly.
            </p>
          )}
        </div>

        <div className="io-col io-import">
          <h3>Import</h3>
          <p className="io-body">
            Reads a file exported here. Nothing is written until you confirm the summary.
          </p>

          <span className="field-label">On conflict</span>
          <div className="seg" role="group" aria-label="Conflict handling">
            <button
              type="button"
              className="seg-opt"
              aria-pressed={mode === "merge"}
              onClick={() => changeMode("merge")}
            >
              Merge
            </button>
            <button
              type="button"
              className="seg-opt"
              aria-pressed={mode === "replace"}
              onClick={() => changeMode("replace")}
            >
              Replace all
            </button>
          </div>
          <p className="io-hint">
            {mode === "merge"
              ? "Adds what's missing and updates matching names. Nothing you have is removed."
              : "Clears the current list first, so the file becomes the whole list."}
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
              <p className="io-drop-title">Drop a .json or .csv file here</p>
              <p className="io-drop-note">Up to 1 MB · columns must match the export</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileInput.current?.click()}
            >
              Choose file
            </button>
          </div>
          {chooseFile}

          <button
            type="button"
            className="btn btn-ghost btn-small io-paste-toggle"
            onClick={() => setPasteOpen((open) => !open)}
          >
            {pasteOpen ? "Hide the paste box" : "Paste JSON instead"}
          </button>
          {pasteOpen && (
            <div className="io-paste">
              <textarea
                className="input"
                rows={5}
                aria-label="Paste an export"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!pasted.trim()}
                onClick={() => read(pasted, "the pasted data")}
              >
                Read pasted data
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
