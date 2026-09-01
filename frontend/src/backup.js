// Reading a backup file, and working out what importing it would do.
//
// Both halves live in the browser on purpose. The summary dialog has to show
// the real diff *before* anything is written (handoff section 12), which
// means the file has to be parsed and compared here whatever the server does
// with it afterwards -- so this is also where a .csv becomes the JSON body
// POST /import accepts, rather than the API growing a second parser that
// could disagree with this one about what a row means.
//
// The matching rule is the server's: trimmed, lowercased name, paired off in
// order when a name appears more than once. Two subscriptions really can be
// called "Netflix" (TODO.md D4), so the file's first one is compared against
// the account's first one rather than one of them winning arbitrarily.

import { todayISO } from "./format";

const STATUSES = ["active", "trial", "paused", "cancelled"];
const CYCLES = ["monthly", "yearly"];

// The design's record shape calls a cancelled plan "archived"; this API has
// said "cancelled" since it had a cancelled_date column. Accepted as a synonym
// on the way in so a file written against the design's vocabulary still reads,
// and never written back out -- export speaks the API's language.
const STATUS_SYNONYMS = { archived: "cancelled", canceled: "cancelled" };

// Columns as GET /export?format=csv writes them, plus the API's own spellings
// for the same fields, so a file exported as JSON and re-saved as a sheet by
// hand still reads.
const CSV_FIELDS = {
  name: "name",
  category: "category",
  status: "status",
  cycle: "billing_cycle",
  billing_cycle: "billing_cycle",
  cost: "cost",
  next_renewal: "next_renewal_date",
  next_renewal_date: "next_renewal_date",
  started_date: "started_date",
  started: "started_date",
  cancelled_date: "cancelled_date",
  paused_date: "paused_date",
};

// A file that cannot be read at all, or a row that would not survive the
// write. Carries the message the page shows verbatim: the user's only repair
// path is editing that file, so it has to name the row and the problem.
export class BackupFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupFileError";
  }
}

// --- reading ---

// A minimal RFC 4180 reader: quoted fields, doubled quotes inside them, and
// CRLF or LF line endings. Written out rather than split(",") because
// "Netflix, shared" is an ordinary subscription name and splitting would tear
// it in half.
function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let started = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"' && field === "") { quoted = true; started = true; continue; }
    if (ch === ",") { row.push(field); field = ""; started = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
      continue;
    }
    field += ch;
    started = true;
  }
  if (started || field !== "") { row.push(field); rows.push(row); }
  return rows;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Rejects "2026-02-31" as well as "yesterday": the regex only proves the
// shape, and a date that rolls over is a typo the server would store as a
// different day than the one written down.
function readDate(value, where, field) {
  const text = (value ?? "").toString().trim();
  if (!text) return null;
  if (!ISO_DATE.test(text)) {
    throw new BackupFileError(`${where} has ${field} "${text}", which is not a YYYY-MM-DD date.`);
  }
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new BackupFileError(`${where} has ${field} "${text}", which is not a real date.`);
  }
  return text;
}

// One row, checked against the same rules POST /subscriptions enforces, so
// the pre-flight here and the write later agree about what is acceptable.
// `where` is already phrased for the reader ("Row 4 of x.csv").
function readRow(raw, where) {
  const name = (raw.name ?? "").toString().trim();
  if (!name) throw new BackupFileError(`${where} has no name.`);

  const rawCost = (raw.cost ?? "").toString().trim();
  if (!rawCost) throw new BackupFileError(`${where} has no cost.`);
  const cost = Number(rawCost);
  if (!Number.isFinite(cost)) {
    throw new BackupFileError(`${where} has cost "${rawCost}", which is not a number.`);
  }
  if (cost <= 0) {
    throw new BackupFileError(`${where} has cost ${rawCost}; a cost has to be more than zero.`);
  }

  const cycle = ((raw.billing_cycle ?? "monthly").toString().trim() || "monthly").toLowerCase();
  if (!CYCLES.includes(cycle)) {
    throw new BackupFileError(
      `${where} has cycle "${cycle}". It has to be ${CYCLES.join(" or ")}.`,
    );
  }

  let status = ((raw.status ?? "").toString().trim() || "active").toLowerCase();
  status = STATUS_SYNONYMS[status] ?? status;
  // A version 1 file predates statuses and says `active` instead; the server
  // resolves that on the way in, and so does this, for the same reason -- the
  // diff has to compare the status the row would end up with.
  if (raw.status == null && typeof raw.active === "boolean") {
    status = raw.active ? "active" : "cancelled";
  }
  if (!STATUSES.includes(status)) {
    throw new BackupFileError(
      `${where} has status "${status}". It has to be one of ${STATUSES.join(", ")}.`,
    );
  }

  const next = readDate(raw.next_renewal_date, where, "next_renewal");
  if (!next) throw new BackupFileError(`${where} has no next_renewal date.`);

  const category = (raw.category ?? "").toString().trim();
  return {
    name,
    cost,
    billing_cycle: cycle,
    next_renewal_date: next,
    started_date: readDate(raw.started_date, where, "started_date"),
    category: category || null,
    status,
    cancelled_date: readDate(raw.cancelled_date, where, "cancelled_date"),
    paused_date: readDate(raw.paused_date, where, "paused_date"),
  };
}

// Every row is read before anything is reported, so a file with several
// problems says how many there are. Stopping at the first would send the user
// back to the same dialog once per bad row, which for a file being edited by
// hand -- the case this whole surface exists for -- is the difference between
// one round trip and six.
function readRows(source, describe) {
  const parsed = [];
  const problems = [];
  source.forEach((item, index) => {
    const [raw, where] = describe(item, index);
    try {
      parsed.push(readRow(raw, where));
    } catch (err) {
      if (!(err instanceof BackupFileError)) throw err;
      problems.push(err.message);
    }
  });
  if (problems.length === 0) return parsed;
  // The first problem in full, then a count: naming one row precisely is what
  // makes the file fixable, and listing all of them makes the message
  // unreadable at exactly the moment it has to be read.
  const others = problems.length - 1;
  throw new BackupFileError(
    others === 0
      ? problems[0]
      : `${problems[0]} ${others} other row${others === 1 ? " has" : "s have"} problems too.`,
  );
}


function parseCsv(text, filename) {
  const rows = csvRows(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) throw new BackupFileError(`${filename} is empty.`);

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const columns = header.map((cell) => CSV_FIELDS[cell] ?? null);
  if (!columns.includes("name") || !columns.includes("cost")) {
    throw new BackupFileError(
      `${filename} has no name and cost columns. The columns have to match the export.`,
    );
  }
  if (rows.length === 1) throw new BackupFileError(`${filename} has a header row and nothing else.`);

  const subscriptions = readRows(rows.slice(1), (cells, index) => {
    const raw = {};
    columns.forEach((field, column) => {
      if (field) raw[field] = cells[column];
    });
    // Counted the way an editor counts, header included, because that is
    // where the user has to go to fix it.
    return [raw, `Row ${index + 2} of ${filename}`];
  });

  // A CSV has one row per subscription and so nowhere to keep a category
  // nothing is using; the ones in use are recovered from the rows themselves.
  const categories = [];
  const seen = new Set();
  for (const subscription of subscriptions) {
    const key = subscription.category?.toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); categories.push(subscription.category); }
  }
  return { version: 2, categories, subscriptions };
}

function parseJson(text, filename) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    throw new BackupFileError(`${filename} is not valid JSON — ${err.message}.`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new BackupFileError(`${filename} is not an export file: the top level is not an object.`);
  }
  if (!Array.isArray(document.subscriptions)) {
    throw new BackupFileError(`${filename} has no "subscriptions" list in it.`);
  }
  const categories = Array.isArray(document.categories)
    ? document.categories.map((name) => (name ?? "").toString().trim()).filter(Boolean)
    : [];
  const subscriptions = readRows(document.subscriptions, (raw, index) => [
    raw ?? {},
    // A JSON path rather than a row number: it is what the user's editor can
    // actually be pointed at.
    `subscriptions[${index}] of ${filename}`,
  ]);
  return {
    // Passed through so an unreadable version is refused by the server rather
    // than being quietly relabelled as current here.
    version: typeof document.version === "number" ? document.version : 2,
    categories,
    subscriptions,
  };
}

/** Reads a dropped, chosen or pasted file into the body POST /import accepts.
 *  Throws BackupFileError with a message that names the file and the row. */
export function parseBackup(text, filename) {
  const looksJson = /\.json$/i.test(filename) || text.trim().startsWith("{");
  return looksJson ? parseJson(text, filename) : parseCsv(text, filename);
}

// --- diffing ---

const key = (name) => (name ?? "").trim().toLowerCase();
const money = (value) => Number(value).toFixed(2);

// True when importing this row would leave the stored one different.
//
// `category` is compared case-insensitively because the server keeps the
// account's existing spelling for a category rather than taking the file's
// (crud.register_category), so "netflix" over "Netflix" is not a change.
// Everything else is compared as written, capitalisation of the name
// included: renaming "netflix" to "Netflix" is a real edit.
function differs(row, stored) {
  return (
    row.name !== (stored.name ?? "").trim() ||
    money(row.cost) !== money(stored.cost) ||
    row.billing_cycle !== stored.billing_cycle ||
    row.next_renewal_date !== stored.next_renewal_date ||
    (row.started_date ?? null) !== (stored.started_date ?? null) ||
    key(row.category) !== key(stored.category) ||
    row.status !== stored.status ||
    (row.cancelled_date ?? null) !== (stored.cancelled_date ?? null) ||
    (row.paused_date ?? null) !== (stored.paused_date ?? null)
  );
}

/** What importing `backup` in `mode` would do to the account on screen.
 *  Computed from the real records, never estimated -- the dialog it feeds is
 *  the last thing the user sees before anything is written. */
export function diffBackup(backup, subscriptions, categories, mode) {
  const known = new Set(categories.map((category) => key(category.name)));
  const inFile = [];
  const seenCategory = new Set();
  for (const name of [...backup.categories, ...backup.subscriptions.map((s) => s.category)]) {
    const k = key(name);
    if (k && !seenCategory.has(k)) { seenCategory.add(k); inFile.push(name.trim()); }
  }

  if (mode === "replace") {
    return {
      mode,
      subscriptions: backup.subscriptions.length,
      categories: inFile.length,
      removed: subscriptions.length,
    };
  }

  // Paired off in file order against the account in id order, matching how
  // crud.import_backup pops them, so the dialog's counts are the ones the
  // import will actually produce.
  const available = new Map();
  for (const subscription of [...subscriptions].sort((a, b) => a.id - b.id)) {
    const k = key(subscription.name);
    if (!available.has(k)) available.set(k, []);
    available.get(k).push(subscription);
  }

  const added = [];
  const updated = [];
  let unchanged = 0;
  for (const row of backup.subscriptions) {
    const matches = available.get(key(row.name));
    const stored = matches?.shift();
    if (!stored) added.push(row.name);
    else if (differs(row, stored)) updated.push(row.name);
    else unchanged += 1;
  }

  return {
    mode,
    subscriptions: backup.subscriptions.length,
    categories: inFile.length,
    added,
    updated,
    unchanged,
    newCategories: inFile.filter((name) => !known.has(key(name))),
  };
}

// --- export ---

/** "subscriptions-2026-09-01.json". The same rule the backend puts in
 *  Content-Disposition; built here because the browser fetches the export
 *  with an Authorization header rather than by navigating to the URL, and so
 *  never sees that header. */
export const exportFilename = (format) => `subscriptions-${todayISO()}.${format}`;
