# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app. Mobile web is a first-class target: it is used on a real
iPhone (Safari/WebKit), not only on desktop browsers.

## Users

People who pay for a handful of recurring services (streaming, software,
memberships) and want to know what those cost and when they charge. Today
signup is gated by an invite code; the goal is open public signup once email
verification (PLAN.md milestone 9) lands. Future design work should serve
strangers arriving with no context, not only the current invited group.

## Product Purpose

Subscription Tracker (live at subscriptionstrack.com, currently labelled Beta)
lets a person record their subscriptions and see three things clearly:

1. **What they spend**: the monthly or annual total, split by category, with a
   trend over time.
2. **What is about to charge**: upcoming renewals, and trials that are about to
   convert to paid plans, early enough to keep or cancel them.
3. **A clean record**: the full history of each subscription, including runs
   of the same service, paused, cancelled and archived plans, with import and
   export backups.

All three are primary jobs. Success means a user trusts the numbers and is
never surprised by a charge.

## Positioning

- **Manual and private.** No bank linking and no data selling. The user enters
  what they pay, and their data is exportable at any time.
- **Honest totals.** A period's total is what actually charges in that period.
  A yearly plan counts in full in the month it renews rather than being
  smoothed into a monthly average, and trials, paused and cancelled plans are
  excluded until they charge. The dashboard states these rules where the total
  is shown.

## Operating Context

- A user signs in, adds subscriptions (name, cost, billing cycle: monthly,
  quarterly or yearly, next renewal date, category, status), and returns
  periodically to check the dashboard or respond to a renewal or trial.
- The dashboard has a period selector (monthly or annual), a headline total, a
  KPI band, category bars, a trend strip, a "coming up" list, a trial banner
  with keep or cancel actions, and the subscription list with search and
  grouped runs.
- Accounts support change password and delete account. Backups import and
  export as CSV.

## Capabilities and Constraints

- **Stack (existing):** React 19 (Vite) frontend, FastAPI and PostgreSQL
  backend, JWT auth. Deployed on Azure Container Apps with Neon Postgres.
- **€0 hosting.** Both apps scale to zero and the database is on Neon's free
  tier. Avoid features that need always-on infrastructure or paid APIs.
- **Multi-currency (PLAN.md milestone 10).** Each subscription keeps the
  currency it is billed in, and each user has one currency that totals are
  shown in and new subscriptions start in. Totals are converted at European
  Central Bank reference rates (fetched from Frankfurter, cached in Postgres)
  and marked ≈. A charge already taken uses its own day's rate, and one still
  to come uses the latest rate. What actually charges is always shown in its
  own currency first. Only the currencies the ECB publishes are supported.
- **Not built yet:** password reset and email verification (milestone 9), and
  any email or notification delivery. Renewal reminders by email depend on
  milestone 9.
- A failed fetch must never blank the page. The last good data stays on screen
  with a banner saying how old it is.

## Brand Commitments

- Name: "Subscription Tracker". Domain: subscriptionstrack.com.
- Voice, taken from the shipped copy: plain, precise and explanatory. The
  interface says exactly how a number was computed and what an action will do,
  without hype.

## Evidence on Hand

- The live app, plus Playwright visual-regression goldens for the dashboard
  (`frontend/`).
- The UI mock for grouped runs: `docs/mocks/issue-49-group-subscriptions.html`.
- None yet: users, testimonials, usage numbers, pricing or press. Do not
  invent any of them.

## Product Principles

1. **Never surprise the user with a charge.** Renewals and trial conversions
   come first in anything time-sensitive.
2. **Totals are honest and explained.** Show what actually charges, and say
   how it was counted.
3. **The user owns the data.** Entry is manual, there is no tracking, and
   everything is exportable.
4. **Last known good beats blank.** Degrade with context and never empty the
   screen.
5. **Clear to a stranger.** Since public signup is the goal, nothing should
   depend on the user already knowing how the app works.

## Accessibility & Inclusion

Target is WCAG 2.2 AA. The app is used with real mobile Safari, so touch
targets, zoom and WebKit behaviour count as much as desktop.
