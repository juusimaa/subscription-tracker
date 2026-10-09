# Feature Specification: Signup Account Cap

**Feature Branch**: `002-signup-account-cap`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Set a cap on the number of user accounts to keep cost within budget — limit total accounts, close signup when the cap is reached, alert the maintainer before that happens." (Follow-up from `specs/001-upcloud-migration`.)

## Context

After the move to UpCloud (`specs/001-upcloud-migration`), hosting costs a flat
monthly fee. The ceiling is €25. More users don't make the bill bigger. They
fill the plan: database storage, server memory and the email allowance. If that
happens unnoticed, the result is a forced upgrade to a more expensive plan or
an outage.

The app already limits what one account can hold: 500 subscriptions and 100
categories. It also caps outgoing email per address and per day. What is
missing is a limit on **how many accounts** exist. This feature adds that limit
so total usage stays inside the plan the maintainer has chosen. Raising the
limit is a deliberate decision, not something that happens by accident.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Signup closes when the cap is reached (Priority: P1)

The maintainer sets a maximum number of accounts. While the app is below it,
signup works exactly as today. When it is reached, a visitor trying to sign up
is told that registration is temporarily closed. No account is created and no
email is sent. Existing users sign in and use the app as normal.

**Why this priority**: this is the protection itself. Without it, nothing else
in the feature matters.

**Independent Test**: set the cap to the current account count plus one.
Register one new address and check it succeeds. Register a second and check
it is refused with the "closed" message, that no account was created and that
no email was sent. Sign in as an existing user and check everything works.

**Acceptance Scenarios**:

1. **Given** the account count is below the cap, **When** a visitor registers,
   **Then** signup behaves exactly as it does today.
2. **Given** the account count has reached the cap, **When** a visitor submits
   the signup form with any address, new or already registered, **Then** they
   see a "registration is temporarily closed" message in their language. No
   account is created or changed, and no email is sent.
3. **Given** the cap has been reached, **When** an existing user signs in,
   resets their password or confirms their address, **Then** it works as it
   does today.
4. **Given** no cap is configured, **When** anyone registers, **Then** there is
   no limit. This keeps local development and the test suite zero-setup.
5. **Given** the cap is reached, **When** the maintainer raises it or accounts
   are deleted so the count drops below it, **Then** signup reopens with no
   restart and no other step.

---

### User Story 2 - Visitors learn signup is closed before filling the form (Priority: P2)

When signup is closed, a visitor who opens the signup view sees the notice
straight away, before typing an address, a password and solving the bot
check.

**Why this priority**: filling in a form only to be refused is frustrating,
but the cap still protects the plan without this story.

**Independent Test**: with the cap reached, open the signup view and check the
notice is shown in place of the form, in English and Finnish. Check that the
sign-in and password-reset views are unaffected.

**Acceptance Scenarios**:

1. **Given** signup is closed, **When** a visitor opens the signup view,
   **Then** they see the closed notice instead of the form, plus a link back to
   sign-in.
2. **Given** signup is open, **When** a visitor opens the signup view, **Then**
   the form is shown as today.
3. **Given** signup closes while a visitor is filling in the form, **When**
   they submit, **Then** they get the same closed message as in Story 1.

---

### User Story 3 - The maintainer is warned before the cap is reached (Priority: P2)

When the account count reaches 80% of the cap, the maintainer is notified.
They then have time to raise the cap, move to a bigger plan or leave signup to
close.

**Why this priority**: without a warning, the first sign of the cap is a
closed signup page. The cap still works, so this is P2, not P1.

**Independent Test**: set the cap so that one more signup crosses 80%. Register
once and check the maintainer receives one notification. Register again below
the cap and check no duplicate is sent for the same threshold.

**Acceptance Scenarios**:

1. **Given** the count is just below 80% of the cap, **When** a signup takes it
   to 80% or above, **Then** the maintainer receives one notification with the
   current count and the cap.
2. **Given** the 80% notification was sent, **When** further signups happen
   below the cap, **Then** no repeat notification is sent until the count has
   dropped below 80% and crossed it again.
3. **Given** the cap is reached, **When** the first signup is refused, **Then**
   the maintainer receives one "signup closed" notification.

---

### Edge Cases

- **Concurrent signups at the boundary**: two visitors register at the same
  moment when one slot is left. At most one account may be created, and the
  count MUST NOT end above the cap.
- **Cap lowered below the current count**: no existing account is affected.
  Signup simply stays closed until the count drops below the new cap.
- **Account deleted**: deleting an account frees a slot right away.
- **Never-confirmed accounts**: a bot or a careless visitor can create accounts
  that are never confirmed. These count toward the cap (see FR-003). Turnstile,
  the rate limits and the daily email cap limit how fast that can happen. The
  80% warning gives the maintainer time to act.
- **Someone re-registering an unconfirmed address while closed**: today, doing
  this sends a link to choose the password. While signup is closed they get
  the closed message instead. Password reset still works for them and confirms
  the address, as it does today.
- **Notification fails to send**: the signup still succeeds or is refused
  correctly. Losing a warning never blocks a signup or lets one through.
- **Import and restore**: importing a backup into an existing account does not
  create an account, so the cap does not apply.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The maintainer MUST be able to set a maximum number of accounts
  through configuration, without a code change. When no cap is set, the
  number of accounts MUST be unlimited.
- **FR-002**: When the number of accounts has reached the cap, signup MUST
  refuse every request. No account is created or changed, and no email is
  sent.
- **FR-003**: Every existing account counts toward the cap, whether or not it
  has been confirmed.
- **FR-004**: The "closed" answer MUST be the same for every address, whether
  it is new, verified or unconfirmed. That way it reveals only that signup is
  closed, never whether an address is registered, which keeps the existing
  anti-enumeration rule.
- **FR-005**: The closed state MUST NOT be checked before the bot check and the
  rate limits. Anyone probing the closed state is held to the same limits as
  anyone signing up.
- **FR-006**: Two signups racing for the last slot MUST NOT both succeed. The
  account count MUST never exceed the cap.
- **FR-007**: Sign-in, password reset, email confirmation, account deletion
  and every feature for signed-in users MUST work unchanged while signup is
  closed.
- **FR-008**: Signup MUST reopen on its own as soon as the count is below the
  cap, whether because the cap was raised or accounts were deleted.
- **FR-009**: The signup view MUST be able to tell, without submitting the
  form, whether signup is currently open, and MUST show the closed notice
  instead of the form when it is not.
- **FR-010**: The closed notice and message MUST exist in English and Finnish.
- **FR-011**: The maintainer MUST be notified once when the count reaches 80%
  of the cap, and once when signup first closes. A notification is sent again
  only after the count has dropped back below the threshold and crossed it
  again.
- **FR-012**: A failure to send a notification MUST NOT affect whether a signup
  succeeds.
- **FR-013**: The README MUST document the new configuration value, how to
  choose it from the database plan's storage, and the new or changed API
  responses.

### Key Entities

- **Account cap**: the configured maximum number of accounts. It may be unset,
  which means unlimited.
- **Account count**: the number of accounts that currently exist, confirmed or
  not. This is what gets compared with the cap.
- **Signup status**: whether signup is open or closed right now. It is
  derived from the count and the cap and is readable by the signup view.
- **Cap notification**: a one-time message to the maintainer when the count
  crosses 80% of the cap or signup closes. It records which threshold it was
  sent for, so it isn't sent twice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the cap set to N, the number of accounts never exceeds N,
  including under concurrent signups.
- **SC-002**: While signup is closed, 100% of signup attempts are refused with
  the closed message, and none creates an account or sends an email.
- **SC-003**: While signup is closed, existing users succeed at sign-in and
  password reset as often as they did before the cap was reached.
- **SC-004**: The maintainer is notified within 5 minutes of the count
  crossing 80% of the cap, with no duplicate for the same crossing.
- **SC-005**: Signup reopens immediately once the count drops below the cap or
  the cap is raised. No restart or deploy is needed when only accounts are
  deleted.
- **SC-006**: The closed answer looks the same whatever address was
  submitted, so an observer cannot tell registered addresses from new ones.

## Assumptions

- **Choosing the cap**: the maintainer sets the cap from the database plan's
  storage divided by the worst-case size of one full account (500
  subscriptions, 100 categories), with headroom. The plan works out that
  per-account figure. A sensible starting value is part of the plan, not this
  spec.
- **Changing the cap**: changing a configuration value with a restart or
  redeploy is acceptable. A runtime admin screen is out of scope
  (constitution Principle V).
- **Notification channel**: notifications go to the maintainer's email through
  the existing email sending, and count toward the existing daily email cap.
  The maintainer's address is a configuration value. If none is set, no
  notification is sent.
- **Waiting list**: none. Refused visitors are told to try again later. Their
  addresses are not collected.
- **Never-confirmed accounts** are not cleaned up automatically by this
  feature. If they become a problem, removing stale unconfirmed accounts is a
  separate feature.
- **Independent of hosting**: the cap works the same on Azure and on UpCloud,
  so it can ship before, during or after the migration in
  `specs/001-upcloud-migration`.
