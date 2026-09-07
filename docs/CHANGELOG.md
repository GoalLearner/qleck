# What shipped, and what has not

The owner's running list used to live in a PDF whose colour coding (red = not
possible, green = done, orange = in progress) does not survive being read by
anything but a person. This is the same list, in the repo, next to the code it
describes — so it can be checked against `git log` rather than remembered.

Builds are TestFlight build numbers (`app.json` → `ios.buildNumber`). Note
that a staged build number is an *intent*: it advances on commit whether or not
an archive was ever cut. App Store Connect is the record of what shipped.

---

## Shipped

### Build 14 → 15 · 31 Aug — the owner's 8/31 list, all seven

| Asked for | Where it landed |
|---|---|
| Real accounts — email, not just Apple | Real auth on the funnel (P3). Sign-in codes only reach the owner's own address until the Resend domain lands. |
| Bring your own plan, Qoach reviews it | "I already have a plan" on intake; the coach prices it as written (prompt v30). |
| Reminders — a morning note with the day's reps | Daily nudges, morning + evening, times editable in You. |
| Witness link — one goal, one person | Effort only: a coach-written title and the days you showed up. Never your words, never your misses. Revoking kills it instantly. |
| Never miss twice | Miss a day and the app steps in on the next one. |
| Milestones on the day you earn them | Confetti on the day, not at the end of the week. |
| Pause | Stored as spans, so pausing never shifts `started_on` and never orphans a check-in. |

Also in this stretch: the Ledger (a week grid per rep), name-your-own pace,
the commitment picker, account deletion that actually deletes, and the beta
readout.

**Three lessons that each cost a build**, kept because they will recur:
`app.json`'s buildNumber is an intent rather than a record; Expo config-plugin
mods chain LIFO, so `withQleckIos.js` must sit first; and local notifications
need no push entitlement, but `expo-notifications` requests one anyway and
fails signing.

### Build 16–19 · 1 Sep — the coach explains itself

- **The rep stops being a wall of text**, and **Qoach writes a how-to** for
  every rep (prompt v27): why it matters, what counts as done, and the actual
  instructions. Moved to Today, where the rep is actually done.
- **Receipts on every number** — each figure says whether it came from your
  answers, from your goal text, or is standard practice, which is said out
  loud rather than dressed up as personalisation.
- **The plan may not invent your life** (prompt v29) — an uncited claim about
  you is a defect, enforced server-side.
- **Quality rules advise, they no longer veto.** A user lost their protocol to
  three rejections on the 1st; a mediocre plan is mediocre, no plan is a broken
  product. Three validators now repair instead of refusing.
- **A judge for plan quality**, plus the harness learning to separate a
  provider outage from a real behavioural failure.
- Five fixes from the first real device pass, and the invisible UTF-8 BOM that
  was breaking every sign-in email.

### Build 20–21 · 2 Sep — the day, and the first six seconds

- **The day-complete card becomes this week's ledger.** Finish the day and the
  card unrolls into a grid of every rep. Misses are quiet here (a faint square,
  never salmon — salmon is an instruction about a day you can no longer act
  on); today's cell fills with a halo it keeps.
- **The cold open.** The welcome carousel promised friends who cheer you and
  points redeemable with partners. None of it exists. It is replaced by a real
  refusal captured from the live pipeline: 3% as asked, 85% for what Qoach will
  back. Nothing on that screen is hand-written, and the harness fails if the
  capture drifts from the prompt.

### Build 22–26 · 2 Sep — the doors, and getting back in

- **Signing out of an Apple account lands on a door you can open.** Apple lives
  only on the auth screen; everything routed returning users to an email and
  password form their account has never had.
- **Signing in mid-session actually reads the account.** The provider hydrates
  once at launch and sits above the funnel, so logging back in showed the
  default profile and an empty goal list — everything intact server-side and
  invisible. Looked exactly like data loss.
- **Seven taps on the version line resets the device.** On iOS the identity
  lives in the Keychain, which survives deleting the app, so the first-run
  screens were unreachable on any device that had ever signed in.
- **Call your own odds** — pick a band before the verdict, then see your call
  beside Qoach's. Compared against the goal *as you asked for it*, which is the
  only comparison honest in both directions. Kept in `goal_outcomes` next to
  the coach's number, so the table can eventually answer whether the coach is
  miscalibrated or the user is.
- **Your name stops being permanent** — editable in You. Fixed a latent wipe on
  the way: an empty handle was being written as empty rather than ignored.

### Build 27 · 3 Sep

- **A plan that has not started is not a rest day.** Locking a plan whose first
  session is not today used to greet you with "Easy — rest is part of the plan"
  on the day you committed, having done nothing.
- **Privacy policy and terms**, live at
  [/privacy](https://qleck-api.richmondcampano93.workers.dev/privacy) and
  [/terms](https://qleck-api.richmondcampano93.workers.dev/terms), served by the
  worker so there is one copy and no hosting to maintain.

### Build 28 · 3 Sep — the last two concept items, mostly already done

- **"Coached, or build your own?"** is DONE, as a fork rather than a question.
  Intake offers all three branches at once: **Ask Qoach**, **"+ I already have
  a plan"** (Qoach prices it as written, prompt v30), and **OR STEAL ONE**. A
  visible fork beats an interview question — you see the choice instead of
  answering something before you are allowed to make it.
- **Public or private goals** is DONE in the only form that can honestly
  exist, and deliberately no further. Every goal is private; the witness link
  is the private→shared control (one goal, one person, revocable, effort
  only). There is no "public" because there is nowhere public to be — no feed,
  no friends, no discovery, all of it sealed until P6. A public toggle today
  would be a control over nothing, which this codebase has already learned
  once: the Notifications chevron was deleted with "a control over something
  that doesn't exist is worse than no control."

  What WAS missing was privacy-shaped: a shared goal looked identical to a
  private one in the list. You could share "quit smoking" with someone, forget,
  and never be told. The card now says **SHARED — ONE LINK IS LIVE**.

### Build 29 · 3 Sep — the known bugs

- **A denial no longer corroborates a claim.** `fabricationErrors` tested
  whether a supporting word appeared anywhere in what you said, so "no
  injuries" contains "injur" and licensed the plan to discuss "your ankle
  injury" — the person saying a thing did NOT happen was read as evidence that
  it did, which is the exact fabrication the guard exists to catch, waved
  through on the strength of the denial. Reachable with ordinary answers.
  Negated clauses are now stripped before corroboration, stopping at clause
  boundaries so "no time, my knee still hurts" keeps the half that is a report.
- **The fabrication guard has bars at last** (`npm run check:fabrication`,
  9 of them, no model calls). It was previously exercised only through the paid
  AI harness — the one rule protecting people from invented facts about
  themselves had no cheap test. The bars were written first and immediately
  caught the regex above, which had a literal backspace character where ``
  was meant.
- **`/me/export` carries the interview answers** as
  `what_you_told_the_coach`. They are the most personal thing held about
  anybody here and they were the one category the export omitted; an export
  that leaves out the sensitive part is the wrong way round.

### Build 30 · 6 Sep — the wait tells the truth

- **The wait becomes a receipt** (Claude Design canvas `Qleck Qoach Wait`,
  project 7091d355). By the time a plan is generating, the app is already
  holding the accepted goal, its duration and pace, Qoach's odds, the odds the
  user called, the FOR / RISK / MOVE read cards and the whole interview — and
  it was showing an empty orb. All of it is now on screen while they wait: the
  read cards turn every 7 seconds, their own answers sit underneath, and the
  elapsed clock is the only thing claiming anything. Pre-verdict there is no
  plan and no odds, so that half shows their goal in their own words and a
  dashed slot where the next question lands — sparse on purpose rather than
  padded.
- **The wait finally has a door.** `onDismiss` had been accepted and dropped
  on the floor by this screen since the original port, so a 75-second wait had
  no exit at all. It is a quiet link until a minute has passed and a bordered
  button after, and both go through a sheet, because leaving costs the whole
  interview and one tap should not spend that.

  The canvas' sheet said *"your answers are saved"*. **They are not** — the
  coach session id lives in a `useRef`, there is no `GET /coach/sessions/:id`,
  and nothing is written down until a plan is locked. The shipped copy says
  what is true: coming back starts again from the goal. Making the design's
  version true is a real feature (persist the session, add the route, offer a
  resume) and is listed below rather than faked.

- **The loading screen stops lying about how long this takes.** It promised
  "Real coaching takes 3–20 seconds". Across 33 measured production calls the
  mean was 26s, a third ran past 40s and the slowest took 75s — so the promise
  was broken on nearly every plan, and a person watching an unchanging screen
  past a stated maximum reasonably concludes it has hung.

  It now shows **elapsed seconds** — the number the owner asked for, and the
  only honest one: a percentage would be elapsed over a guess, racing ahead
  and then stalling near the end on exactly the slow plans where the
  reassurance matters most. A plan is ONE model call with no progress signal;
  there is nothing to be a percentage OF. The copy changes with the real wait
  ("Writing your plan. Usually about half a minute." → at 30s "Taking longer
  than usual" → at 45s "Still going. It hasn't stalled.") and the footer says
  the one thing a waiting person needs: **Qoach is thinking, not stuck.**

  Worse than the copy was the timer: during plan-building the interval was
  **skipped entirely** and the line pinned to "Building your protocol…", so
  the longest wait in the app was one frozen sentence. The pre-verdict lines
  deliberately carry no figure — that phase's duration cannot be derived from
  the request log, because the user's own thinking time sits between turns,
  and inventing one would repeat the mistake being fixed.

### Unreleased · 7 Sep

- **"The coach hit a snag" traced to one arithmetic slip.** A real failure on
  7 Sep: for `Bench 315 lbs in 5 weeks` the model wrote phase 1 as weeks 1-3,
  phase 2 as weeks 4-5 and phase 3 — a one-week test phase — as week 5. Phase 3
  therefore started on the week phase 2 ended. `validateProtocol` is BLOCKING,
  so all three attempts died on that, the user got the snag screen, and the
  retry burned another three calls: six model calls over 2m15s, five rejected,
  three of them returning byte-identical output.

  Worse, the repair layer runs only *after* `validateProtocol` passes, so the
  four session/day mismatches in the same plan — which `alignStepsToSessions`
  fixes for free — were never even reached. One overlap disabled everything.

  `retilePhaseWeeks` now repairs it before validation, on the same principle as
  `reconcileDuration`: an overlap truncates the earlier phase to end just
  before the next begins (the minimal edit, and what a taper squeezed onto the
  end of a block usually means), and a gap is closed by pulling the later phase
  back with its length intact. It will not merge, drop, reorder or resize a
  phase's steps, and non-numeric weeks stay the validator's problem. Running it
  first also re-enables `reconcileDuration`, which bails on untiled phases and
  so was disabled by the same slip.

  Replaying the stored production payload through the fixed pipeline: one edit,
  `validateProtocol` clean, `alignStepsToSessions` repairs its four, session
  errors clean. `npm run check:phases` — 13 bars, no model calls, the first of
  which is that exact plan.

- **A swipe can no longer throw away a plan mid-generation.** The in-app "+"
  is an iOS modal, which is swipe-to-dismiss by default, and the coach session
  is held in memory only — nothing about it is written down until a plan is
  locked. One accidental downward swipe during a 60-second generation
  therefore discarded the goal, the entire interview and the verdict, silently,
  with nothing to come back to. Reported from the field more than once.

  The gesture is now latched off while a call is in flight, and only then;
  Cancel and the wait screen's own door still leave, and both say what leaving
  costs. `usePreventRemove` is what actually does it — on iOS it sets the
  sheet's `preventNativeDismiss`, where `gestureEnabled: false` governs the
  interactive pop gesture on PUSHED screens and leaves a modal's drag alone.

---

## Not shipped

### Not started, deliberately

- **The community layer** — friends, cheering, doing goals together. Sealed in
  `src/demo` behind `DEMO_ENABLED`, guarded by `npm run check:demo`, returning
  on real backends at ROADMAP P6. The toy `FriendKey` model is REPLACED then,
  not migrated.
- **Scoring and rewards** — "hit milestones to earn months free" needs in-app
  purchases and a subscription, neither of which exists. Parked with the rest
  of monetisation until there is real usage data.

### Blocking submission (owner)

- **Store screenshots.** Material that now exists: the cold open's refusal, the
  day-complete ledger, the odds dial carrying your own guess, a rep how-to.
- **A Resend sending domain** (~$10/yr). Until it lands, only the owner's own
  address receives sign-in codes — so no tester can sign up by email. Rotate
  `RESEND_API_KEY` as part of it, not before, and paste the new key at the
  prompt rather than piping it.
- Paste the privacy URL into App Store Connect, and the demo credentials with
  the note that the password field is behind "I already have an account".

### Known and unfixed

- **`repriceTrimmedProtocol`** — this entry was OVERSTATED and is corrected
  here rather than deleted. It runs three validators, not two: `validateProtocol`,
  `sessionErrors` and `physiquePillarErrors`, plus an explicit empty-phase
  check. What it skips — `provenanceErrors`, `exhaustedKeyErrors`,
  `milestoneProvenanceErrors` — all police the MODEL's obligations against the
  answers, and REMOVING steps cannot violate any of them (milestones cite
  answer keys, not step ids). Re-running them would risk refusing the user's
  own deliberate choice to drop a commitment. No fix made, on purpose.
- **There is no client-side request timeout.** Not in `src/api/coach.ts`, not
  in `src/api/device.ts`, nowhere in `src/` — so React Native falls back to the
  platform default (~60s on iOS). Three of the 33 measured calls ran past that,
  which means those plans may have been *failing* rather than merely feeling
  slow: the user sees "the coach hit a snag" after a minute and a retry costs
  another ~26s. The fix is either an explicit longer timeout on the protocol
  request or the detached-work-plus-poll pattern the simulation already uses.
  Named here rather than bundled into the loading-screen change.
- **`ai_requests` has no duration column.** Every figure in the entry above was
  inferred from the gaps between consecutive attempts in one session, which is
  only possible when a call was retried. A `duration_ms` column — one migration,
  one INSERT — would make the copy calibratable from real data and would show
  whether the retry fixes actually moved the number.
- **Leaving a wait loses the interview.** The design for the wait screen's
  exit assumed the goal, answers and verdict survive it. They do not: the coach
  session id is client-side only and there is no route to re-read a session,
  so a resume would need persistence plus `GET /coach/sessions/:id`. The
  shipped copy states the real cost instead of the intended one.
- **The landing handoff is not built.** The canvas resolves the wait before it
  hands over — ring stops, "Plan ready.", clock freezes — then the plan rises
  over the receipt, sharing the goal headline so it never moves. Today the
  plan still replaces the screen in a hard cut. It touches `ProtocolReveal`,
  so it is its own change.
- Play internal upload never done.
