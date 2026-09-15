# Brief for Claude Design — fewer words on the coach screens

Paste everything below the line into the **Qleck mobile app onboarding** project
(the one holding `Qleck Coach.dc.html`, `Qleck Ask Intake.dc.html` and
`Qleck Qoach Wait.dc.html`). Hand the result back as a handoff bundle.

---

## The ask

Our testers wrote: *"Minimize the explanation, and if they want to see the
reasoning why, they can click to expand it. Too many words on the screen makes
the user scroll down — if it can fit all on one screen without scrolling, that is
the best-case scenario."*

Redesign four coach screens so each one **fits a 393 × 852 iPhone without
scrolling**, with the reasoning **one tap away** instead of always on screen.
Same visual language as the existing canvases (Electric Night tokens, Space
Grotesk display, DM Sans body, mono labels) — this is a density pass, not a new
look. Design dark and light.

Measured today at 393 × 852: the **verdict** runs ~2 screens (the build button
sits ~1,390pt down), the **counter-offer** ~1.6 screens, the **plan** ~4.5
screens (the first screen ends at the first rep's title), and the **question
chat** scrolls from question 2 (with the keyboard up, less than one question
bubble is visible).

## The rule, per screen

- The **decision and its button** are visible without scrolling: the question
  and its answer chips; the odds and "Build my plan"; the plan's first week and
  "Lock it in".
- **Why** is one tap away, with the tap target saying what it opens
  ("Why 72%?", "How to do it", "Qoach's note").
- These must **stay reachable** (one tap is fine): the AI disclaimer and "Report
  this response" (store requirement), each rep's full details, the three read
  cards, and Qoach's note.
- Plan for real lengths, not short placeholders (see Sample content).

## Screen 1 — the question chat (`ChatThread`)

Today, top to bottom: "Qoach" + **QUESTION n OF 3** + progress bars · "YOUR
GOAL" + the goal bubble (1–3 lines) · each past round: the question (19pt,
~5 lines), its *why it matters* line (13.5pt, 2–4 lines, shown on every past
question), the answer bubble · the active question (~5 lines) with 2–4 rows of
answer chips · the answer input with two captions.

Design:
- Past rounds collapse to a compact **question → answer** pair; *why it
  matters* only on the active question (or behind a small "why?").
- The active question and its chips stay fully visible with the keyboard up.
- **New control — change an earlier answer.** A past answer is tappable (a quiet
  CHANGE label). Tapping asks **"Change this answer? The questions after it
  will be asked again."** [Keep it] [Change it]. Then that question becomes the
  active one again, with its original chips and the old answer prefilled, and a
  "Keep my answer" link to cancel. The header count drops back to that
  question. After 3 changes the CHANGE labels disappear. Show: normal thread,
  the confirm sheet, the re-answer state.

## Screen 2 — the verdict, feasible goal (`FeasibleVerdict`)

Today: chips (✓ FEASIBLE · N WEEKS) · the goal statement as the title (25pt,
5–6 lines) · a subtitle (2 lines) · the odds card: QOACH'S CALL, pace pills,
"OR NAME IT" week stepper, a large dial (~240pt tall), "YOUR CALL" guess line,
a 2–3 line caption, an amber "priced with N unknowns" note, "STEADY IS QOACH'S
PICK · TAP A PILL TO SWITCH" · "BUILT FROM YOUR ANSWERS" + up to 6 answer chips ·
"QOACH'S READ" + three read cards (FOR / RISK / MOVE, each a 2–3 line headline,
tap to expand detail + lever) · a "N today isn't N forever" line · **Build my
plan — N weeks** · "Change my goal" · the disclaimer (4–5 lines) + Report.

Design:
- One screen: title (use the **short title**, 3–7 words, full statement on tap
  or small), the odds as the hero, pace pills, **Build my plan**, and a
  **"Why 72%?"** entry that opens the three reads + the answers they were built
  from.
- "OR NAME IT" can live behind the pills (e.g. a "Pick my own weeks" pill).
- Captions, hints and the "isn't forever" line go inside the Why view.
- Disclaimer + Report: a small "About these odds" link at the bottom that opens
  them.
- Keep the existing line under the button when the plan is already written:
  **YOUR PLAN IS WRITTEN — OPENS INSTANTLY**.

## Screen 3 — the counter-offer (`CounterVerdict`)

Today: chips (⇄ COUNTER-OFFER · N WEEKS OFFERED) · "About that goal." · two goal
cards ("AS YOU ASKED" + "QOACH'S VERSION", ~8 lines together) · the dial card
(pills: as asked / Qoach's version / yours, "OR NAME IT", dial, guess line,
caption up to 4 lines, hint 2 lines) · Qoach's assessment in quotes (7–10 lines) ·
buttons (**Take the deal — Qoach's version**, "Attempt my original — N% odds"
when allowed, "Build my plan — N weeks" + "Take the deal instead — N%" for a
named runway). No disclaimer on phones today (it should have one).

Design:
- One screen: the two versions side by side or as a two-state toggle with both
  odds visible, the dial, and the buttons.
- The assessment behind **"Why Qoach countered"**.
- Keep every existing button state (deal / attempt original / named runway,
  and the "only builds plans it can price at 20% or better" refusal line).

## Screen 4 — the plan reveal (`ProtocolReveal`)

Today: YOUR PROTOCOL + DRAFT + odds chip · the statement (5 lines) · "N weeks ·
N phases · starts at N reps a week" · "Tap a rep to change it · × drops it and
re-prices." · a week strip · **phase 1 open**: title + focus (focus ~6 lines in a
narrow column) and each rep with its **full details paragraph** (10–12 lines
each in a ~130pt-wide column, ~250pt per rep, 5–6 reps) · "+ ADD A REP" ·
milestones · phases 2–4 folded · Qoach's note (~15 lines) · fixed bottom bar:
Lock it in · Start over · the disclaimer + Report (~265pt).

Design:
- Each rep is **one line of title + its one-line gist** (every phase-1 rep
  already has a ≤90-character gist — see Sample content), tap to open the full
  details / how-to.
- Phase header: title + a one-line focus; the rest on tap.
- Qoach's note behind **"Qoach's note"**; disclaimer + Report out of the fixed
  bar (a link at the end of the scroll is fine).
- Target: summary + phase 1's reps + the bottom bar on the first screen for a
  6-rep phase.
- **New control — ticks.** The × becomes a **tick** on every rep, all ticked by
  default. Unticking dims the rep. Unticking a rep also unticks its later
  versions in later phases, with an inline **"Also out of phases 2–4 · keep
  those"**. Folded phase headers read **"4 of 5 reps"**. The last rep in the
  plan can't be unticked (inline: "Keep at least one rep — or start over to
  change the goal"). A phase with every rep unticked shows **"Nothing left here
  — weeks 9–10 carry on with “…”"**.
- **The bottom bar owns the state** — design all four:
  1. nothing changed → **Lock it in**;
  2. reps unticked, not yet priced → **Re-price — 3 reps out** replaces Lock,
     odds chip reads **— RE-PRICE**, "Undo changes · Start over" below;
  3. priced → **72 → 61 · YOUR PLAN, YOUR PRICE** + one cost line
     (e.g. *"Protein and sleep are out — two of the five pillars a physique plan
     stands on."*) above **Lock it in**;
  4. pricing failed → a one-line reason ("Couldn't reach Qoach — nothing's
     changed yet.") + **Try again — 3 reps out** + "Undo changes · Lock without
     odds".

## Also: two small surfaces already specified

- **Where are you starting?** (Ask Intake turn 1c: two cards, *I have a goal* /
  *I already have a plan*, no "OR STEAL ONE" list). Already designed; only
  adjust if the density pass changes the type scale.
- **"Not for me" in the rep sheet** (the sheet a rep opens on Today). Under
  [Got it] [Tweak], a text link **Not for me** → an inline confirm: **Take
  “Hit ~150 g protein” out?** *"From today on. Days you already banked stay
  banked, and Qoach re-prices the plan."*, a toggle **Also from weeks 4–8 — 3
  later versions** (on), [Keep it] [Take it out] → result **Out of the plan.
  72% → 64%** + the cost line + [Done]. Failure: *"Qoach couldn't re-price just
  now — nothing changed."* [Try again] + "Take it out without re-pricing".

## Sample content (real lengths, from a test plan)

- Goal statement (title today): *Gain 5 lbs of lean muscle at 170 lbs, training
  3 evenings a week* · short title: *Gain 5 lbs of muscle in 20 weeks* · 20 weeks.
- Phases: **Set the Table** (w1–5) — *Get the three evening sessions locked in,
  start eating like someone who's growing, and get a baseline so we can tell
  whether the surplus is real.* · **Add Weight to the Bar** (w6–11) · **Push and
  Hold** (w12–16) · **Land It** (w17–20).
- Phase 1 reps (title — gist; each also has a 200–380 character details
  paragraph):
  - Lift three evenings a week — *Monday, Wednesday, Friday evenings: full-body
    lift, 3 sets of 6–10 per exercise.*
  - Write every set down and beat last week — *Log every working set, then beat
    last session by a rep or 2.5 kg.*
  - Add one extra meal on training days — *On training days, eat one extra
    400–500 calorie meal or shake beyond your normal day.*
  - Hit ~150 g protein a day (150 g, daily) — *About 150 g of protein every day,
    spread across four meals.*
  - In bed by 11:15pm (daily) — *Lights out by 11:15pm, seven nights a week.*
  - Weigh in once a week (170 lbs) — *Saturday morning weigh-in, same scale, one
    number a week.*
- Milestones: *Five weeks, fifteen sessions* (w5) · *The scale has moved and the
  bar has too* (w11) · *Heaviest training of the plan, held* (w16) · *Five pounds
  up, still training* (w20).
- Qoach's note: ~500 characters. Typical question: ~106 characters. Read card
  detail: 1–3 sentences.

## Deliverable

Artboards at 393 × 852, dark and light:
1. Chat — normal, confirm-change sheet, re-answer state, keyboard up.
2. Verdict (feasible) — default, Why open, plan-written line.
3. Counter-offer — default, Why open, named-runway state.
4. Plan reveal — default, a rep opened, ticks with the four bottom-bar states,
   a fully unticked phase.
5. Rep sheet — Not for me: confirm, done, failed.
