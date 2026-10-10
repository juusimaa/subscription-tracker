# Subscription Tracker Constitution

## Core Principles

### I. Code Is Written to Be Read

This is a learning project, and its code is the primary documentation.

- Every source file MUST open with a comment stating what it is for.
- A non-obvious decision MUST be explained in a comment where it is made — the
  constraint, the alternative rejected, or the bug it prevents — not in a
  separate document that can drift. Comments explain *why*; they MUST NOT
  restate what the code plainly does.
- New code MUST match the idioms, naming and comment density of the code around
  it. A new pattern is introduced only when the PR says why the existing one
  does not fit.
- Configuration files (workflows, Dockerfiles, Compose, pytest.ini) are code
  and follow the same rule: every non-default setting carries its reason.
- The README is the guided tour that ties layers together. A change that alters
  a layer's responsibility, an environment variable, or a test file's purpose
  MUST update the README in the same PR.

Rationale: comments placed at the decision survive refactors; external docs do
not. Readable code is what keeps the project maintainable by one person.

### II. Every Rule Has a Test (NON-NEGOTIABLE)

- Every behavior change MUST ship with tests in the same PR. A PR that changes
  behavior without a test change MUST state why no test is possible.
- Every bug fix MUST include a regression test that fails without the fix.
- Each test MUST protect a named rule: its name and docstring say which rule and
  why it matters (e.g. "another user's row is a 404, not a 403"), so a failure
  explains itself.
- Tests MUST be deterministic: no reliance on wall-clock time, network access,
  or test order. External services (exchange rates, email, bot checks) are
  replaced with in-process fakes.
- The backend suite MUST run with a bare `pytest` from `backend/` on a clean
  checkout, with no services started and no environment to configure.
- Edge cases in date and money arithmetic (month-end clamping, leap days,
  cancellation and pause boundaries, currency conversion) MUST be tested
  directly, not only through the API.

Rationale: the suite is the specification of record. A rule without a test is
a rule the next change can silently break.

### III. Test What Production Runs

- The backend suite MUST pass against both SQLite (the zero-setup default) and
  PostgreSQL 18 (what production runs). Postgres is the leg that decides
  correctness; SQLite is kept green so the zero-setup path does not rot.
- Tests MUST run on the interpreter and major versions the app ships with
  (Python 3.13, Postgres 18) as declared in the Dockerfiles and Compose file.
- Database-specific behavior (e.g. `Numeric` returned as `Decimal` vs `float`)
  MUST be handled in code and covered by a test, never papered over in a test.
- User-visible frontend changes MUST be covered by the Playwright visual
  regression suite. Baselines change only intentionally, and the updated
  screenshots are reviewed in the PR that changes them.
- Behavior that differs on real devices (e.g. iOS WebKit) MUST be verified on
  that device before merge when a change touches it; emulators are not proof.

Rationale: a test environment that differs from production in the one way that
matters gives green checks for broken code.

### IV. One Source of Truth per Contract

- The schema is owned by `backend/app/models.py` and Alembic together. Every
  model change MUST ship with a migration, and `test_migrations.py` MUST keep
  proving that `alembic upgrade head` produces exactly the model schema and that
  downgrades leave nothing behind. Data migrations MUST be tested on the rows
  they change.
- The HTTP API is the contract between frontend and backend. Breaking changes
  to a response shape or status code MUST be called out in the PR and updated
  on both sides in the same PR.
- Server-side values are authoritative: totals, derived dates and conversions
  are computed by the backend; the frontend MUST NOT recompute a figure the
  server already returns.
- Every user-facing string MUST exist in all supported locales (English and
  Finnish); `npm run check:locales` enforces it.
- Security-relevant behavior — per-user isolation, anti-enumeration responses,
  rate limits, email caps — is part of the contract and MUST have tests that
  assert it explicitly.

Rationale: when the same fact is defined in two places, they diverge. A single
owner, checked by a test, keeps them honest.

### V. Simplicity and a Small Surface

- Prefer the simplest design that meets the current requirement (YAGNI). An
  abstraction, configuration option or service is added only for a need that
  exists now, and the PR states the need.
- A new runtime dependency MUST be justified in the PR; one that the standard
  library or an existing dependency covers is not added. Test-only dependencies
  live in `requirements-dev.txt` / `devDependencies` and never ship in images.
- Optional infrastructure MUST fail open: the app runs correctly without Redis
  and degrades rather than breaks when an optional service is absent.
- Dead code, unused flags and stale comments are removed in the change that
  makes them dead, not left for later.
- Complexity that a principle would reject MUST be recorded in the plan's
  Complexity Tracking section with the simpler alternative and why it fails.

Rationale: every line and dependency is maintenance cost carried indefinitely
by a very small team.

## Quality Gates

A PR is mergeable only when all of the following hold:

- Required CI checks are green: `sqlite` and `postgres` (backend tests) and
  `visual` (frontend visual regression + locale check). Required checks MUST
  always report a status — skip work inside the job, never with a workflow
  `paths:` filter that would leave a required check pending forever.
- `npm run lint` passes for frontend changes.
- No secrets in the repository or workflow files; tests generate throwaway
  keys themselves.
- New and changed source files satisfy Principle I (header comment, reasons
  recorded at the decision).
- Migrations, where present, apply cleanly on Postgres and are covered by
  `test_migrations.py`.

## Development Workflow

- Every change goes through a branch and a pull request; nothing is committed
  directly to `main`. PRs are squash-merged.
- A PR does one thing. Its description states what changed, why, and how it was
  verified (tests added, visual baselines updated, device checks performed).
- Feature work that changes user-facing behavior starts from a spec (or an
  approved design/mock) before implementation; the spec or mock is the reference
  that review checks against.
- Reviews check the code against this constitution, not only for correctness:
  missing tests, unexplained decisions and unjustified dependencies are
  blocking findings.

## Governance

- This constitution supersedes conflicting conventions elsewhere in the
  repository. Where a README section or comment disagrees with it, the
  constitution wins and the other is corrected.
- Amendments are made by pull request that edits this file, states the reason,
  and lists any code or template that must change to comply. An amendment that
  makes existing code non-compliant MUST include a migration plan or the
  compliant code.
- Versioning follows semantic versioning: MAJOR for removing or redefining a
  principle, MINOR for adding a principle or materially expanding guidance,
  PATCH for clarifications and wording.
- Compliance is checked in every PR review and in each feature plan's
  Constitution Check gate. Deviations MUST be justified in writing (Complexity
  Tracking) or fixed before merge.
- Runtime development guidance lives in `README.md` and the comments it points
  to; the constitution states the rules, those explain the mechanics.

**Version**: 1.0.1 | **Ratified**: 2026-10-09 | **Last Amended**: 2026-10-10
