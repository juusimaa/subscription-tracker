---
name: Subscription Tracker
description: A well-typeset statement of what you pay, and when.
colors:
  signal-red: "#ec3013"
  signal-red-pressed: "#dd2b0f"
  signal-red-deep: "#ae1800"
  signal-red-wash: "#fff2ef"
  signal-red-ink: "#4d170e"
  paper: "#f3f2f2"
  paper-raised: "#eae9e9"
  ink: "#201e1d"
  rule: "color-mix(in srgb, #201e1d 40%, transparent)"
  stroke: "color-mix(in srgb, #201e1d 52%, transparent)"
  idle-bar: "#d7d3d3"
  tile-neutral: "#605d5d"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(52px, 7vw, 92px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "42px"
    fontFeature: "'tnum' 1"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: "24px"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  lead:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "28px"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "14px"
    letterSpacing: "0.08em"
rounded:
  none: "0px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-red-deep}"
    textColor: "{colors.paper}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "8px 14.4px"
  button-primary-hover:
    backgroundColor: "#7c1405"
  button-primary-active:
    backgroundColor: "{colors.signal-red-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 14.4px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 4px"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
    height: "36px"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "7px 12px"
  segment-view-selected:
    backgroundColor: "{colors.signal-red-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "7px 12px"
  tag-trial:
    backgroundColor: "{colors.signal-red-wash}"
    textColor: "{colors.signal-red-ink}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  tag-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  attention-banner:
    backgroundColor: "{colors.signal-red-wash}"
    textColor: "{colors.signal-red-ink}"
    rounded: "{rounded.none}"
    padding: "28px 0"
  trial-section:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "28px 0 42px"
  dialog:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "32px"
---

# Design System: Subscription Tracker

## Overview

**Creative North Star: "The Statement"**

The interface reads like a well-typeset bank statement. The total is the
headline, every figure sits in a tabular column, and every number explains how
it was counted in plain prose close to it. Nothing is decorative. Grey paper,
near-black ink, ruled lines and one red do all the work, in the tradition of
Swiss modernist print: a single grotesque (Archivo), flush-left text, square
corners and generous vertical air between sections.

The system is quiet until something matters. Neutral is the default state of
every component. Red and the heavy 800 weight are spent only where money or an
action is. The hero total is red because it is the reason you opened the page.
The trial section's top rule is red because a trial is about to cost money.
The selected period is red because it says which view you are reading; a
selected form option (plan type, export format, conflict mode) is only an
answer, so it fills with Ink. When red appears
anywhere else, the meaning gets diluted.

Density is moderate and desktop-first. A 1240px column, 32px gutters, and
section spacing on a 14px cadence (14 / 28 / 42 / 56 / 112) give a
statement-like rhythm. Below 760px the layout reflows into a single column and
every dialog becomes a bottom sheet. Dark mode is a full reversal of the same
system. Today it follows the OS setting only; an in-app theme toggle is planned
but not built.

**Key Characteristics:**
- One typeface (Archivo 400/600/800), with 800 reserved for figures, names and actions.
- One accent (Signal Red), spent on money, deadlines and the current selection.
- Zero border radius everywhere, including tags, inputs, dialogs and brand tiles.
- Rules, not cards: 2px rules between major sections, 1px between peer rows.
- Flat at rest. Only popovers, menus and dialogs cast a shadow.
- Tabular figures on every number.

## Colors

The palette is a near-monochrome paper-and-ink ground with a single saturated
signal red. Every tint is drawn from one OKLCH ramp per role on a shared
lightness scale, so the same step of any role matches in visual value.

### Primary
- **Signal Red** (`signal-red`): the hero total, selected trend bars, the
  category fill and focus rings: large figures and non-text marks, where
  3:1 is enough. Its job is to pull the eye to money and to the current
  choice. It reaches only 3.76:1 against paper, so it never carries small
  text and never sits under paper text.
- **Signal Red Pressed** (`signal-red-pressed`): reserved; no longer used by
  the primary button.
- **Signal Red Deep** (`signal-red-deep`): every red that has to meet 4.5:1.
  As text: the "next charge" and "trial converts" labels, the selected
  month's value and tick, field-error labels, and destructive actions (menu
  items, the delete trigger and destructive ghost buttons). As a fill under
  paper text (`--color-accent-fill`): primary buttons, the selected period
  (Monthly or Yearly) and picker cells. In dark
  mode the fill becomes `#ff563c` under dark text, and the text step becomes
  the reversed ramp's `#ffc4b8`.
- **Signal Red Wash** (`signal-red-wash`): the fill for attention surfaces:
  the server-error banner, row messages and the trial tag.
  Hover fills are never red; they are Ink at 7%.
- **Signal Red Ink** (`signal-red-ink`): text set on Signal Red Wash.

### Neutral
- **Paper** (`paper`): the page ground, and the text colour on red fills.
- **Paper Raised** (`paper-raised`): inputs, dialogs, popovers and cards. It
  sits one step off the ground, so a raised surface reads without needing a
  border.
- **Ink** (`ink`): all body text and headings.
- **Rule** (`rule`): Ink at 40%, used for every divider between rows and
  sections.
- **Stroke** (`stroke`): Ink at 52% (40% in dark mode), the border of every
  input and control (segmented controls, secondary buttons, steppers, chips).
  Control edges need 3:1, and the Rule only reaches 2.4:1.
- **Idle Bar** (`idle-bar`): unselected trend bars.
- **Tile Neutral** (`tile-neutral`): the fallback brand tile and the mobile
  avatar square.

Secondary text is Ink mixed toward transparent at fixed percentages, never a
new grey: 78% for lead prose, 70% for labels and notes, 68% for hints,
sub-notes and placeholders, 66% for cancelled and earlier runs, 35% for idle
sort arrows, 10% for bar tracks and 7% for neutral hover fills. No text step
goes below 66%: that is the lowest that still reaches 4.5:1 on every light
ground it sits on (paper, raised paper, hover tints and the search-match
wash).

A second accent ramp (`--color-accent-2`, a softer coral) is defined in
`modernist.css` but nothing on screen uses it today. Treat it as reserved, not
as permission for a second accent.

In dark mode the ground becomes `#16151a` (raised `#201f24`) and ink becomes
`#f1efee`. The neutral and accent tint ramps reverse end to end, so every
fill-and-text pairing stays legible without component changes. Signal Red
itself does not change.

### Named Rules
**The One Signal Rule.** Signal Red marks money, deadlines and the current
selection, and nothing else. If an element is red, the user should be able to
say which of those three it is. Errors and destructive actions also stay red,
because each one is about to cost something. Section eyebrows, nav links,
sort headers, links, ghost actions, disclosure chevrons and status tags are
Ink. They are structure and controls, not signals.

**The Mixed-Ink Rule.** Never introduce a new grey hex. Secondary text and
fills are Ink mixed toward transparent at the established percentages, so they
track the theme automatically.

## Typography

**Display Font:** Archivo (with system-ui, sans-serif)
**Body Font:** Archivo (with system-ui, sans-serif)

**Character:** A single sturdy grotesque at three weights. Archivo 800 carries
every figure, name and action. 400 carries the explanatory prose. The contrast
is in weight, not in typeface.

### Hierarchy
- **Display** (800, clamp(52px, 7vw, 92px), 1.02, -0.03em): the hero total
  only, in Signal Red, pulled left by -0.045em to correct its optical
  sidebearing. One per page.
- **Headline** (800, 34px, 42px): KPI figures.
- **Title** (800, 17px, 24px): category names and amounts, the trial
  headline, account section headings. Dialog titles step up to 20px, or 22px
  on mobile sheets.
- **Body** (400, 15px, 1.55): table cells, lists and general text. Table text
  is 14px.
- **Lead** (400, 17px, 28px, max 52ch): the hero explanation of how the total
  was counted.
- **Label** (400, 13px, 0.08em, uppercase): eyebrows (in Ink),
  field labels and KPI labels (Ink at 70%). Table headers use 11px.
- **Buttons** use the heading face at 800, 14px (13px small).

### Named Rules
**The Tabular Rule.** Every figure on the page uses `font-feature-settings:
'tnum' 1`, including money, dates, counts and email addresses. A column of
money that changes width as its digits change reads as noise.

**The Weight Carries Meaning Rule.** 800 marks things you read as values or
act on: figures, names, buttons. Prose is never bold to add emphasis.

## Layout

A single centred column, max 1240px with 32px gutters (20px at 760px and
below). The sticky header aligns its brand with the column's left edge at any
width.

The dashboard is a vertical statement: hero (total plus period controls) →
next-charge strip (the soonest charge, plus the next trial conversion when
that comes later, each with its keep or cancel action) → trend strip → four-up KPI band → a 7/5 split of categories and coming-up →
trial section → subscription table → add form → import/export. Major sections
are separated by 2px rules and spacing on the 14px cadence: 14px inside rows,
28px between sub-blocks, 42px around bands, 56px between major sections, and
112px for empty-state air. The component spacing scale (4 / 8 / 12 / 16 / 24 /
32) handles padding inside controls.

At 760px and below:
- the KPI band becomes a 2×2 grid;
- the split stacks;
- the table becomes a stacked list with sort chips;
- nav links collapse so that only the brand, the avatar square and "Log out"
  remain;
- controls grow to at least 44px tall (48px for sheet actions);
- every dialog becomes a full-width bottom sheet with a 2px Signal Red top
  edge;
- a fixed bar at the bottom holds one full-width "Add subscription" button and
  nothing else, because whatever it holds covers the content scrolling
  under it.

Safe-area insets are respected at the bottom.

### Named Rules
**The Rules-Organise Rule.** Structure comes from ruled lines, not boxes:
2px between major sections, 1px between peer rows and inside control groups.
Do not wrap sections in cards.

## Elevation & Depth

Flat by default. Depth comes from tonal layering, with Paper Raised one step
off Paper, and from rules. Shadows exist only on things that float above the
page: the period picker popover, the row-actions menu and dialogs. In dark
mode the shadow becomes a 1px light hairline edge plus ambient darkness.

### Shadow Vocabulary
- **Small** (`0 1px 2px color-mix(in srgb, #2d2b2b 14%, transparent)`):
  available, rarely used.
- **Medium** (`0 3px 10px color-mix(in srgb, #2d2b2b 16%, transparent)`):
  available, rarely used.
- **Large** (`0 12px 32px color-mix(in srgb, #2d2b2b 22%, transparent)`): the
  popover, menu and dialogs.

### Named Rules
**The Only-Floaters-Lift Rule.** A shadow means "this is above the page and
will go away". Inline content never casts one.

## Shapes

Every corner is square (0px). That includes inputs, buttons, tags, dialogs,
sheets, bars and the 20px brand tile. Borders are 1px for control strokes and
2px for structural edges: section rules, popover and menu frames, banner top
edges, and the invalid-field stroke. Accent edges mark state. A 2px Signal Red
top rule marks an attention banner or a mobile sheet, and a 2px inset left rule
marks a row being edited in place. The only round shape is the radio dot.

### Named Rules
**The Zero-Radius Rule.** No border radius anywhere. Do not soften it.

## Components

### Buttons
Heavy type with no softening. Neutral unless the button is the main action.
- **Shape:** square (0px), 8px by 14.4px padding, Archivo 800 at 14px.
- **Primary:** Signal Red Deep fill with Paper text (6.4:1). Hover deepens to
  `#7c1405`, active to Signal Red Ink. Use at most one per region.
- **Secondary:** transparent with a 1px Stroke border and Ink text. Hover fills
  with Ink at 7%.
- **Ghost:** Ink text with minimal padding. Hover fills with Ink at 7%. Used
  for "Edit", "More", "Manage" and "Show archived". "Review trials in the
  table" is a standalone ghost and gets 12px side padding. A destructive ghost
  (`.destructive`) is the one exception and keeps Signal Red Deep text.
- **Disabled:** 45% opacity.
- **Focus:** a 2px Signal Red outline, offset 2px, on every interactive
  element.

### Segmented control
A row of square options joined by 1px Stroke separators inside a 1px Stroke
frame. The selected option fills with Ink and Paper text. Used for plan type,
export format and conflict mode. The period selector (Monthly or Yearly,
`.seg-view`) is the one exception: it fills with Signal Red Deep, because it
names the view the page is showing.

### Tags
Square, 12px text, 2px by 8px padding. **Trial** is Signal Red Wash with Signal
Red Ink text. **Active** is neutral wash with neutral ink. **Outline** has a
1px Stroke border with Ink text and is used for "Beta", "Paused", "Cancelled"
and "Archived".

### Inputs / Fields
- **Style:** Paper Raised fill, 1px Rule stroke, square, 36px minimum height
  (44px on mobile), 14px text, Signal Red caret.
- **Focus:** the border turns Signal Red and the outline sits flush.
- **Error:** a 2px Signal Red border, a Signal Red Deep label, and the message
  at the field. Warnings, such as a duplicate service name, are advisory and
  never block saving.
- Select and date inputs drop native appearance so they size consistently on
  iOS Safari. Select uses a CSS-gradient chevron drawn in currentColor.

### Navigation
A sticky header on Paper with a 2px bottom rule. On the left is the brand
("Subscriptions", Archivo 800) with an outline "Beta" tag. On the right are the
text nav links (Ink, with the current page underlined at 2px), the account email (tabular,
Ink at 68%) and a secondary "Log out" button. On mobile the email becomes a
32px square avatar showing the initial.

### Attention banner
The server-error banner: Signal Red Wash fill, a 2px Signal Red top rule, and
a Title-weight headline in Signal Red Ink. Banners never blank the page, and
nothing is ever a toast.

### Trial section
The full list of running trials, below the split. The next-charge strip under
the hero already shows the soonest conversion with its actions, so this
section is not a second alarm: it sits on the page ground with Ink text, and
only its 2px Signal Red top rule marks the deadline. That rule takes the place
of the 2px divider between the split and the table, and the section closes
with a 2px Rule. Trials are 1px-ruled rows, each with its own actions
("Convert to paid" and "Cancel before it charges"). Both are Secondary buttons
at the same width, so neither looks like the default choice.

### Save notice
A write that went through says so in one plain line next to where it
happened: under the list heading, or under the desktop add form. It is 14px
Ink at 78%, never Signal Red, and reads like "Netflix cancelled. Show
cancelled". When a row has just left view, the line says where it went. It
offers Undo only where the opposite write is exact (archive, restore to list,
convert a trial). It stays until the next write replaces it, and it is a
`role="status"` region that stays mounted even when empty. It is not a toast.

### Data table
Uppercase 11px headers over a 2px rule, and 1px rules between rows. Each
header is a sort button. The active one shows its arrow in full Ink, and the
idle arrows sit at 35%. On mobile the active sort chip fills with Ink. Rows carry a
brand tile, a sub-note line at 12px (Ink at 68%), and Ghost actions aligned
right. Cancelled rows mute to Ink at 66%, tile included. The Paid to date column
shows what a service has charged so far, across every run, in the same
weight as the Cost beside it; its sub-note always says the span it covers
("since May 2023", "Sep 2022 – Aug 2026") or why there is no figure. On
mobile it is the row's third line. It sorts largest first, with unknown
figures last either way. Grouped runs fold
under a disclosure chevron. An open group has no rules inside it and closes
with a 2px rule under its lifetime row. Editing happens in place, marked by the
inset left rule.

### Brand tile
A 20px square showing one or two letters in Archivo 800 on the service's own
brand colour (per-service data, not tokens), falling back to Tile Neutral.
It is decorative and hidden from screen readers, because the name always sits
beside it.

### Trend strip and category bars
The trend strip shows flat rectangular bars in Idle Bar, with the selected
month in Signal Red and its value printed above. Category bars are a 14px track
of Ink at 10% with a Signal Red fill. Neither has rounded ends, gradients or
gridlines.

### Dialogs and sheets
A Paper Raised panel with the Large shadow, 32px padding and square corners,
over a backdrop of neutral 900 at 50%. Actions are right-aligned. A
destructive action is pushed to the far left and is never the default:
archive comes before delete. On mobile, every dialog becomes a bottom sheet
with stacked full-width actions at 48px.

## Do's and Don'ts

### Do:
- **Do** use Signal Red only for money, deadlines and the current selection
  (The One Signal Rule).
- **Do** set every figure with tabular numerals.
- **Do** separate sections with 2px rules and peer rows with 1px rules.
- **Do** derive secondary text from Ink at the established percentages (78 /
  70 / 60 / 55 / 45).
- **Do** use Signal Red Deep, not Signal Red, for small red text.
- **Do** put an explanation of how a number was counted next to the number,
  in Lead or note-size prose.
- **Do** keep errors at the field and transport problems in a banner at the
  top of the page.
- **Do** make every dialog a bottom sheet below 760px, with targets at least
  44px tall.

### Don't:
- **Don't** use any border radius (The Zero-Radius Rule).
- **Don't** wrap sections in cards or bordered boxes. Rules do the organising.
- **Don't** add shadows to inline content. Only popovers, menus and dialogs
  lift.
- **Don't** introduce a second accent colour or a new grey hex.
- **Don't** use toasts. Problems live where they happened, or in a top-of-page
  banner.
- **Don't** blank the page on a failed fetch. Keep the last known good data
  under a banner.
- **Don't** introduce a second typeface or use bold for emphasis in prose.
