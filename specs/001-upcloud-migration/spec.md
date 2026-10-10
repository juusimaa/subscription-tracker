# Feature Specification: Move Hosting from Azure to UpCloud

**Feature Branch**: `001-upcloud-migration`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "specify moving from Azure to UpCloud that would also host PostgreSQL. Probably Starter 2GB + PostgreSQL that is maintained by UpCloud with daily backups."

## Context

Production today is split across three providers: the web app and API run on
Azure Container Apps, which scale to zero when idle, and the database is on
Neon's free tier, which also scales to zero. Both are cheap, but the first
request after an idle period has to wake the app and then the database.
Sign-in, signup and dashboard loads are slow on that request. Bot traffic
also keeps waking the frontend, so the bill is never quite zero.

The move puts the whole production stack with one European provider. The app
runs on a single always-on UpCloud server (the entry-level 2 GB plan). The
database is a PostgreSQL service that UpCloud runs, with daily backups. The
domain, DNS, email sending and bot check stay where they are today.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Users keep using the app without noticing the move (Priority: P1)

A signed-in user opens `subscriptionstrack.com` after the move. Their
subscriptions, categories, grouped runs, currencies and settings are all there,
unchanged. They sign in with their existing password, and every link they
saved still works. Signup, email verification, password reset and the bot check
work as before.

**Why this priority**: a move that loses or alters data, or breaks sign-in,
fails no matter what else it achieves. Moving with nothing lost is the minimum
viable outcome.

**Independent Test**: before cutover, record per-user counts and totals
(subscriptions, categories, lifetime spend, monthly total in each user's
currency) and export a JSON backup for a test account. After cutover, compare
the counts and totals and sign in as the test account. Then run signup →
verify → sign in → password reset with a new address.

**Acceptance Scenarios**:

1. **Given** a user with data in the current production database, **When** they
   sign in on the new hosting with their existing password, **Then** they see
   exactly the same subscriptions, categories and totals as before cutover.
2. **Given** the new hosting is live, **When** a new visitor registers, **Then**
   they receive the verification email, can verify, and can sign in. The bot
   check, rate limits and email caps work as before.
3. **Given** a user who requested a password-reset or verification link before
   cutover, **When** they open that link after cutover, **Then** the link works
   as long as it has not expired.
4. **Given** the new hosting is live, **When** anyone visits
   `subscriptionstrack.com` or `api.subscriptionstrack.com`, **Then** they get a
   valid HTTPS connection with no certificate warning.

---

### User Story 2 - Fast responses at any time of day (Priority: P2)

A user who opens the app after hours of no traffic gets the sign-in page and
then their dashboard as quickly as they would at a busy time. Nothing has to
wake up first.

**Why this priority**: this is the user-visible benefit of moving. The cold
start is the one part of the app that feels slow.

**Independent Test**: leave the app idle for at least 2 hours. Then time the
first page load and the first sign-in and compare them with a warm request.

**Acceptance Scenarios**:

1. **Given** no traffic for 2 hours or more, **When** a user loads the site and
   signs in, **Then** the dashboard appears within the same time budget as a
   warm request (see SC-002).

---

### User Story 3 - The maintainer can deploy, recover and stay within budget (Priority: P2)

The maintainer merges a PR and the change goes live automatically, as it does
today. If the database is damaged or data is deleted by mistake, they can
restore a backup from the last 3 days with a written procedure. They get
alerted if the site goes down. Cost stays within budget because every resource
is fixed-price, so no cost alert is needed.

**Why this priority**: there is one maintainer. Hosting that needs manual
deploys, or that cannot be restored, costs more than it saves.

**Independent Test**: merge a trivial change and watch it reach production
with no manual step. Follow the restore runbook to restore a recent backup into
a scratch database and check that its row counts match. Stop the app on purpose
and check that the downtime alert arrives.

**Acceptance Scenarios**:

1. **Given** a PR is merged to `main`, **When** the build finishes, **Then** the
   new version is serving production with no manual step. Users see at most a
   brief interruption.
2. **Given** a deploy whose new version fails its health check, **When** the
   rollout runs, **Then** the previous version keeps serving traffic and the
   deploy is reported as failed.
3. **Given** a daily backup from the last 3 days exists, **When** the
   maintainer follows the restore runbook, **Then** they get a working database
   with the data as of that backup.
4. **Given** the site stops answering its health check, **When** it has been
   down for 5 minutes, **Then** the maintainer receives an alert.

---

### User Story 4 - The old hosting is shut down cleanly (Priority: P3)

Once the new hosting has run without problems for a soak period, the Azure
resources and the Neon database are removed. Nothing in the repository, the
workflows or the README still refers to them as the live setup.

**Why this priority**: until this is done there are two production setups, and
bills, secrets and documentation keep drifting. It can wait until the new
hosting has proven itself.

**Independent Test**: after decommissioning, the Azure resource group and Neon
project no longer exist, the deploy credentials for Azure are removed from the
repository settings, and a search of the repository for the old hostnames and
provider-specific deploy steps finds only historical notes.

**Acceptance Scenarios**:

1. **Given** the new hosting has served production for 7 days with no
   data-affecting incident, **When** the maintainer decommissions the old
   hosting, **Then** the Azure resources, the Azure deploy credentials and the
   Neon project are deleted. Before that, a final export of the Neon database
   is archived outside both providers.
2. **Given** decommissioning is done, **When** someone reads the README and the
   deploy workflow, **Then** they describe the UpCloud setup as the live
   production environment.

---

### User Story 5 - Pause the site to stop paying for it (Priority: P3)

The maintainer decides to halt the site for a while, for example while there
are no active users, and stops paying for hosting. While it is paused,
visitors to `subscriptionstrack.com` see a short notice that the service is
paused, not an error. Later the maintainer resumes the site and every account
comes back exactly as it was.

**Why this priority**: the move takes the bill from about €1 to up to €25 a
month. A clean way to stop that bill without losing user data keeps hosting
cost from being a reason to shut the project down for good. The site must run
before it can be paused, so this comes after the move itself.

**Independent Test**: on a staging copy, or in production during a quiet
period, follow the pause runbook. Check that the hosting cost stops, the
notice is shown and the archive is stored outside UpCloud. Then follow the
resume runbook and compare row counts and a test account's data with the
archive.

**Acceptance Scenarios**:

1. **Given** the site is live, **When** the maintainer follows the pause
   runbook, **Then** writes are frozen first, a full export of the database is
   archived outside UpCloud and checked, and only then are the server and
   database removed.
2. **Given** the site is paused, **When** anyone visits either public URL,
   **Then** they see a "paused" notice over HTTPS, at no ongoing hosting cost.
3. **Given** the site is paused, **When** the maintainer follows the resume
   runbook, **Then** the server and database are recreated from the archive,
   every account can sign in, and the data matches the archive.

---

### Edge Cases

- **Writes during cutover**: a user saves a change while data is being copied.
  The cutover must stop writes or refuse them visibly, so a change is never
  accepted on the old side and then lost.
- **DNS propagation**: for a while after the DNS change, some visitors still
  reach the old hosting. The old side must not accept writes after the data
  copy (read-only, maintenance page, or stopped).
- **Rollback**: the new hosting fails after cutover. The maintainer can point
  DNS back to Azure + Neon within the soak period. Any data written on the new
  side since cutover is either copied back or explicitly accepted as lost, and
  the runbook says which.
- **Real client address**: the new hosting puts a different proxy in front of
  the app. Per-client rate limits must still be keyed on the visitor's real
  address. They must not end up keyed on the proxy's address, which would put
  everyone in one bucket, and a value the client supplies must not be trusted.
- **Database unreachable**: the managed database is restarting or under
  maintenance. The health check reports unhealthy, and the app returns errors
  rather than hanging. It recovers on its own when the database is back.
- **Server reboot**: after an OS update or a reboot by the provider, the app
  comes back by itself with no manual step.
- **Disk full**: logs or container images fill the server's disk. Old logs and
  images are cleaned up automatically.
- **Certificate renewal**: HTTPS certificates renew before they expire with no
  manual step, and a failed renewal raises an alert before users see warnings.
- **Stopping instead of deleting**: stopping the server or the managed
  database does not stop UpCloud from billing for it. A pause that only stops
  the machines saves almost nothing, so the runbook must remove them.
- **Lost archive**: the provider's daily backups go away with a deleted
  database. The pause archive is then the only copy of user data, so it must
  be checked before anything is deleted and kept in two places.
- **Pending links during a pause**: verification and reset links sent before a
  pause may expire while the site is down. Users request a new one after it
  resumes.
- **Bot scanners**: probe traffic (WordPress or `.git` paths) is answered
  cheaply. It must not drive up cost or slow down real users.

## Requirements *(mandatory)*

### Functional Requirements

**Data and cutover**

- **FR-001**: All production data (users and their password hashes, email
  verification state, subscriptions, runs, categories, settings and pending
  tokens) MUST be moved to the UpCloud-managed PostgreSQL database with nothing
  lost or altered.
- **FR-002**: The new database MUST run the same PostgreSQL major version that
  the test suite runs against (18), as the constitution's Principle III
  requires. (Was 16; changed on 2026-10-10 when the rehearsal found Neon on
  18.6. Postgres doesn't support restoring into an older major version, so
  the new database, CI and local development all moved to 18. See research
  R2.)
- **FR-003**: The data copy MUST be checked before traffic switches: per-table
  row counts and a sample of per-user totals MUST match between the old and new
  databases.
- **FR-004**: Cutover MUST be done from a written runbook. It covers freezing
  writes, copying, checking, switching DNS, smoke tests and rollback, and is
  committed to the repository.
- **FR-005**: Planned downtime for the cutover MUST be at most 30 minutes.
  The site MUST show a maintenance message during that time, not errors.

**Hosting and behavior**

- **FR-006**: The frontend and the API MUST be served from a single always-on
  UpCloud server in an EU region. Neither may scale to zero.
- **FR-007**: The public URLs MUST stay the same: `subscriptionstrack.com` for
  the app and `api.subscriptionstrack.com` for the API, both over HTTPS, with
  certificates that renew themselves.
- **FR-008**: All current production behavior MUST be preserved: email sending,
  the bot check on signup and reset, the per-address and daily email caps,
  allowed origins for API calls, and the anti-enumeration responses.
- **FR-009**: Per-client rate limits MUST be keyed on the visitor's real
  address behind the new proxy, and a client MUST NOT be able to spoof that
  address.
- **FR-010**: The database MUST accept connections only from the app server.
  It MUST NOT be reachable from the public internet, and connections MUST be
  encrypted.
- **FR-011**: The server MUST accept inbound traffic only for HTTPS, HTTP (to
  redirect to HTTPS) and administrative access. Administrative access MUST use
  keys, not passwords.
- **FR-012**: The server's operating system MUST apply security updates
  automatically. The app MUST come back by itself after a reboot.
- **FR-013**: Secrets (token-signing key, email API key, bot-check secret,
  database credentials) MUST NOT be stored in the repository or in images.
  They MUST be stored on the new hosting so that only the deploy process and
  the running app can read them.
- **FR-014**: Whether the cache runs in production MUST be decided explicitly
  in the plan. Today production runs without it, and the app fails open either
  way.

**Deploy, backup and operations**

- **FR-015**: Every merge to `main` MUST deploy automatically to the new
  hosting. A version that fails its health check MUST NOT replace the running
  one.
- **FR-016**: Deploy credentials MUST be limited to deploying this app. They
  MUST NOT give control of the provider account or of other resources.
- **FR-017**: The database MUST be backed up at least daily by the provider,
  and backups MUST be kept for at least 3 days. This is the retention of the
  provider's affordable plans, and it was chosen to stay within budget
  (decided 2026-10-09).
- **FR-018**: A restore procedure MUST be documented. It MUST be rehearsed once
  before cutover by restoring a backup into a separate database.
- **FR-019**: The maintainer MUST be alerted when the site has been unreachable
  for 5 minutes or longer. There is no cost alert: the resources are
  fixed-price, so the monthly cost follows from the plan (decided
  2026-10-09).
- **FR-028**: The maintainer MUST be alerted when the managed database passes
  80% of its plan's storage, and when the server passes 80% of its memory or
  disk. Users fill the plan before they raise the flat monthly bill, so this
  is the early warning that the plan is too small. The account cap that keeps
  growth within the plan is specified separately in
  `specs/002-signup-account-cap`.
- **FR-020**: The total monthly cost of the new hosting (server, database,
  backups and outbound traffic) MUST stay within €25.

**Decommissioning and documentation**

- **FR-021**: After a 7-day soak with no data-affecting incident, the Azure
  resources, the Azure deploy credentials and repository variables, and the
  Neon project MUST be removed. Before that, a final Neon export MUST be
  archived.
- **FR-022**: The README, deploy workflow and environment-variable docs MUST
  describe the new hosting as production in the same PR that makes it
  production (constitution Principle I). Every non-default setting in the new
  server's configuration MUST carry its reason.
- **FR-023**: Required CI checks (`sqlite`, `postgres`, `visual`) MUST keep
  reporting on every PR throughout the move.

**Pause and resume**

- **FR-024**: The maintainer MUST be able to pause the site with a committed
  runbook. Pausing freezes writes, archives a full database export outside
  UpCloud, checks the archive's row counts, and then removes the billed
  UpCloud resources.
- **FR-025**: While paused, both public URLs MUST show a "paused" notice over
  HTTPS, in English and Finnish, at no ongoing hosting cost.
- **FR-026**: The maintainer MUST be able to resume the site with a committed
  runbook that recreates the hosting and restores the archive with nothing
  lost. Resume MUST be rehearsed once before the first real pause.
- **FR-027**: The pause archive MUST be stored in at least two places outside
  UpCloud, and access to it MUST be restricted to the maintainer, because it
  contains password hashes and email addresses.

### Key Entities

- **Production server**: the single always-on machine that serves the frontend
  and API. It sits in an EU region, with a fixed public address that DNS points
  to.
- **Managed database**: the provider-run PostgreSQL instance holding all app
  data. It can only be reached from the production server and has daily
  backups.
- **Backup**: a daily point-in-time copy of the managed database. Each one has
  a creation time and a retention period, and can be restored into a new
  database.
- **Cutover runbook**: the ordered, committed checklist for the move: freeze,
  copy, check, switch, smoke test, rollback.
- **Pause archive**: the full, checked database export taken when the site is
  paused. While paused, it is the only copy of user data.
- **Deploy credential**: the narrowly scoped secret that lets CI roll a new
  version onto the production server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After cutover, 100% of accounts can sign in with their existing
  password. Per-table row counts and the sampled per-user totals match the
  old database exactly.
- **SC-002**: After 2 hours of no traffic, the first page load completes in
  under 2 seconds and the first sign-in in under 1 second, measured from a
  European connection. Today these take several seconds because the app and
  the database have to wake up first.
- **SC-003**: Planned downtime during cutover is at most 30 minutes, and users
  see a maintenance message for all of it.
- **SC-004**: A merged PR is live in production within 15 minutes, with no
  manual step.
- **SC-005**: A restore from the latest daily backup into a usable database
  completes in under 1 hour by following the runbook.
- **SC-006**: Availability measured over the first 30 days is at least 99.5%,
  excluding the announced cutover window.
- **SC-007**: Monthly hosting cost stays within the ceiling set in FR-020 for
  the first full billing month.
- **SC-008**: Within 14 days of cutover, no Azure or Neon resource tied to this
  app is still running or billing.
- **SC-009**: Pausing the site brings the hosting cost to €0 from the next
  billing hour. Resuming brings back every account and its data, matching the
  archived row counts exactly, within 2 hours of starting the runbook.

## Assumptions

- **Plan sizes**: the server is UpCloud's entry-level 2 GB plan, as the
  maintainer proposed. The database is the smallest single-node
  UpCloud-managed PostgreSQL plan. Current traffic (a handful of users, under
  0.5 GB of data) fits easily in both. A single node means no automatic
  failover; that is acceptable for a beta.
- **Region**: both the server and the database are in the same UpCloud EU
  region, Helsinki by default, to keep latency between them low and the data
  in the EU.
- **Unchanged services**: DNS and the domain stay at Cloudflare in DNS-only
  mode, email stays on Resend (`mail.subscriptionstrack.com`) and the bot check
  stays on Cloudflare Turnstile. Only their hostname and origin settings change
  if the app's addresses change.
- **Images**: container images keep being built by CI and published to the
  repository's container registry. Only where they are run changes.
- **Downtime**: the user base is small and in beta, so a short, announced
  maintenance window is acceptable. A zero-downtime migration is not required.
- **Local development** is unchanged: Compose with local Postgres and Redis.
- **Cache**: production keeps running without the cache unless the plan shows
  a current need (constitution Principle V). The server could host it at no
  extra cost, so the plan must decide explicitly.
- **Billing while stopped**: according to UpCloud's pricing docs, a managed
  database bills hourly until it is deleted, even while stopped. Third-party
  listings say the same for the Developer and General Purpose server
  families. So pausing means deleting the resources, not stopping them. The
  plan should confirm both points with UpCloud before relying on them.
- **Backup retention trade-off**: 3 days of backups means a mistake noticed
  later than that, such as data deleted by accident, cannot be undone from a
  backup. Each user can still keep their own JSON export. The maintainer
  accepted this to keep cost low (2026-10-09).
- **Budget fit**: €25 a month must cover the 2 GB server and the smallest
  managed PostgreSQL plan. A 1-node 2 GB database plan alone is listed at about
  €30 a month, so the plan has to pick the smallest database tier that is
  actually needed (around 1 GB). If that does not fit, the plan must say so
  before any resource is bought.
- **Pause notice**: the plan decides where the notice is served from, for
  example a free static page at the existing DNS provider. It must cost
  nothing while the site is paused.
- **Soak and decommissioning**: the 7-day soak and 14-day decommission deadline
  are defaults the maintainer can change.
- **Out of scope**: high availability or multi-node setups, a CDN in front of
  the site, moving DNS or email providers, and any change to app behavior
  beyond what the new hosting requires.
