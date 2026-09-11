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

### Build 31 · 7 Sep — the snag, taken apart

#### 8 Sep — a follow-up from the device

- **The read cards can be read.** Closed, a card is a 150pt slot that turns
  every 7 seconds, so the headline clamps at two lines and the detail at three
  — and the longest reads, which are the ones worth having, lost their point
  mid-sentence with no way in. Tapping now opens all three in full, scrollable,
  with the odds card and the answers standing down to make room; the carousel
  freezes while it is open, because a card that turned away mid-sentence would
  be worse than the clamp it was opened to escape. `TAP TO READ` says so on the
  card, since nothing else about it looked tappable.
- **The 45-second status line stopped truncating.** "The longest we have
  measured is 75 seconds." did not fit the one-line slot beside the clock on a
  393pt screen. It is "Longest measured: 75 seconds." now — same fact, and
  visible.

Three of the four fixes below are server-side and went live on the 7th; only
the swipe fix needed a build. The diagnosis started from one real session —
`Bench 315 lbs in 5 weeks`, six protocol calls in 2m15s, five rejected — and
every claim here was checked against its stored payloads rather than guessed.


- **One plan is no longer generated twice at once.** The verdict kicks a
  background draft so that accepting a plan is instant, and every `prepare`
  kicks another. `driveDraft` guarded with `draft_protocol IS NULL` — a read,
  not a claim — so two kicks seconds apart both saw null and both spent ~26
  seconds and a paid call on the same plan. Meanwhile `POST /protocol`
  generated in-request on a cache miss without ever asking whether a draft was
  already being written. On 7 Sep at 06:26 the user tapped "Build my plan" 27
  seconds after the verdict, while its draft was still running, and two full
  generations ran side by side.

  Both call sites carried a comment saying *"driveSim's lock keeps this and the
  polls' drivers from ever doubling the work"*. True of `driveSim`, which takes
  a `working_until` lock — but with `SIMULATIONS="off"` the branch actually
  taken is `driveDraft`, which had no lock of any kind. The comment described
  protection the code path did not have.

  There is now one claim (migration 0017, `draft_working_until`) that both
  paths honour: a single conditional UPDATE, so the loser finds out by getting
  zero changed rows back. It carries an expiry rather than trusting a release,
  because the usual way a draft ends is its isolate being torn down when
  `waitUntil` runs out — which is exactly what happened that night. And a
  "Build my plan" that arrives mid-draft now waits briefly for it (bounded well
  under a generation, abandoned the moment the claim lapses) and takes the
  instant path when it lands, instead of starting a second generation.

  `npm run check:draft` — 16 bars against a fake D1 and an injected clock.

  Honest limit: a draft that is genuinely still running when the wait expires
  still gets a second generation beside it. Bounding the wait is the deliberate
  trade — every second spent waiting is added to the user's wait if the draft
  does not land.

- **A retry stops re-asking a question the model already answered.** In the
  same incident, attempts 1 and 2 each returned attempt 0's protocol byte for
  byte — and sent the identical correction prompt to get it, necessarily, since
  the thing being corrected had not changed. Two paid calls and about forty
  seconds bought nothing.

  The loop already knew this shape: a NULL emission is retried clean, because
  asking a model to "minimally correct `null`" spends the attempt it was given
  to recover. A repeat is the same mistake wearing different clothes — the
  model has read the errors and declined to move — so it is now retried clean
  too, at a temperature (0.9 rather than 0.4) that can actually leave the
  groove. Raised there and nowhere else.

  The decision lives in `backend/src/retryPolicy.ts` so it can be checked
  without spending a model call: `npm run check:retry`, 15 bars.

  Not changed: `reviseProtocol` and the maintenance generator run their own
  two-attempt loops and still lack even the null-emission guard. The repeat
  rule cannot fire in two attempts, but "correct this null" can — worth its
  own pass, not folded in silently here.

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

### Build 32 · 9 Sep — the cousin’s list: the bugs, the picker, by-when, the editor

The owner and his cousin produced nine notes. Two were bugs hit by accident;
they go first, one commit each. The rest is a plan (`~/.claude/plans/`),
sequenced and checked against the code before a line was written.

- **"Nothing happens when you click adjust."** Three causes, all real:
  - The button the tester met was a stub. On the plan reveal, "Adjust
    something" did nothing but show a toast at the TOP of the screen —
    *"Adjusting mid-plan lands after launch"* — while the finger was at the
    bottom. A placeholder labelled like a feature. Deleted, along with the
    toast machinery that existed only to say so; editing lands in that slot
    when it is real.
  - **Regenerate with the new engine** (Goals, old-shape goals) reached for
    `navigation` inside a component that has none. TypeScript let it through
    because `lib.dom` declares a global `navigation`; iOS threw on press.
    Now a prop from the parent, like Tweak already was.
  - **Tweak from a rep** closed the RN `<Modal>` and pushed the Adjust screen
    in the same tick — two UIViewController presentations crossing, the iOS
    "presentation in progress" swallow. The sheet now hides itself and the
    navigation waits for `onDismiss`. On iOS only; elsewhere there is no race
    and `onDismiss` never fires. Tweak also passes the rep it was open on,
    which the per-rep drop (step 3) will need.
- **"Moved my finger up and it got rid of my plan completely."** There is no
  swipe handler anywhere in the app; four things could do this, and each one
  now needs a decision:
  - **"Start over" sat four points under "Lock it in" with no confirmation**,
    inside the home-indicator strip on a notch phone, and a finger that lands
    on it and drifts up still fires on release. The tester's own words are
    the label. It opens a sheet now — the same one the wait screen has,
    lifted into a shared `LeaveSheet` — that says what starting over costs.
    The bottom bar also clears the safe area.
  - **A plan locked in onboarding was memory-only until the last onboarding
    step.** Three screens later it was rebuilt from the funnel's result,
    dropping the odds and the coach session id on the way — and if iOS
    reclaimed the app in between, it had never existed. It is now queued the
    moment it is locked (`onPlanLocked` → `setGoalPlan`), the exact path the
    in-app "+" has always used. `syncAccount` flushes that queue before it
    refreshes, so the end-of-funnel sync is safe on a fresh sign-up too.
  - **The swipe latch covered only calls in flight.** With the plan on screen
    and not yet locked — the most expensive state there is — the "+" modal
    was swipe-dismissible again. The latch now covers every phase past
    intake; error and refusal are excluded because their screens are the way
    out. Locking leaves through the latch (`leaving`), not around it, or the
    modal would never close.
  - Not changed: Drop and Delete on a goal are arm-then-tap with a 3–4s
    window — a confirmation, if a thin one.
- **"I have 5 weeks — price that" has somewhere to go.** The cousin's note:
  *"give more flexibility to the user even if not ideal/optimal."* The v29
  name-your-own-weeks picker already did exactly that, with no floor — and
  rendered only on FEASIBLE verdicts. Three gates switched it off on a
  counter-offer, which is precisely the verdict where the coach has just
  overruled the user's timeline. That page was strictly binary: the coach's
  weeks, or the coach's read of the original.

  The picker is on the counter-offer page now, its stepper already reading
  the runway the user asked for. Pricing it adds a third pill (**Yours · 5wk
  · 26%**), flips the dial to the priced number, and the button becomes
  **Build my plan — 5 weeks**; below the 20% floor the number is still shown,
  with the reason it will not build, and only the deal builds. The ladder a
  counter clamps against is its own rung — the one price that verifiably
  exists. The original ask is deliberately not a rung: on a scope-changed
  counter it prices a different statement, and the two cannot be told apart.

  Two latent bugs the picker would have exposed, fixed on the way:
  - The generator chose its pacing sentence by pace KEY — "time-crunch" only
    for sprint, "no-rush" for everything else — so a custom runway shorter
    than the verdict's would have been described as "more air than your
    recommended pace". It is chosen by direction now.
  - **The 20% floor did not cover custom paces.** A 10% runway was buildable
    on any feasible verdict. It is uniform now: the picker prices anything
    (a brutal runway gets its honest number), the build does not.

  `npm run check:pace` — 22 bars, no model calls. No prompt text changed;
  the ladder the model is shown is data, and its template is untouched.
- **"By when?" on intake.** The cousin's other duration note: *"users should
  be asked how long it takes to achieve the goal."* The interview asks that
  in two of twelve domains and never for strength or physique — and the
  intake screen said the opposite policy out loud: *"Qoach sets the timeline,
  that's the point."*

  A `+ BY WHEN?` toggle now sits beside the plan toggle; open, it is a
  `− 8 wk +` stepper. At submit the value is folded into the goal text as
  *"… — in 8 weeks."* — the exact phrasing the decision rule already
  extracts a timeline from, so the coach reads it as a stated fact and prices
  it as `original_*` before deciding whether to counter. No backend change, no
  prompt change. Weeks rather than a date because the coach thinks in whole
  weeks and a date picker is a native dependency; a real date can still be
  typed. The goal box is capped so the fold can never exceed the server's 600
  characters. Sub-headline now: *"Got a date in mind? Name it — Qoach prices
  it straight."*

  A runway the coach judges too tight WILL be countered — that is the rule
  working — and the helper line under the stepper says so, which is only true
  because the counter-offer picker shipped first. `npm run check:timeline`,
  16 fixtures.
- **A thin own-plan gets a real interview.** "I already have a plan" used to
  tighten the interview to one or two questions, no extension, whatever the
  plan said — on the theory that the plan carries most of what an interview
  collects. True of a five-line plan; false of a one-line one, and the rule
  could not tell them apart. So a user who typed *"run more"* under "I
  already have a plan" was asked LESS than a user who typed nothing, and the
  gaps were filled silently. The cousin's note was the other way round: *"if
  the user gets stumped, Qleck comes back in for suggestions."*

  The band now scales with how much the plan says. Four or more commitment
  lines keep today's one-to-two. Two or three earn two-to-three (four while
  the answers keep adding facts); one earns two-to-four (five). The floor
  rises to two for every thin plan — odds priced on a single fact would be
  the dishonesty the coached floor exists to prevent. The line counter is the
  one `ownPlanErrors` already used, now shared, so the two rules never
  disagree about the same text. Server-side, live; nothing to build.

  Honest limit: the steer the model reads still SAYS "one or two questions".
  The band is enforced by withholding the verdict tool, so behaviour is right
  regardless — but parameterising that text is a prompt edit, gated by the
  paid harness, and is its own later commit. `npm run check:band`, 20 bars.
- **The server can edit a plan** (invisible until the editor lands). The
  foundation for "build it yourself": `POST /coach/sessions/:id/protocol/edit`
  takes ONE op — rename, re-time, re-target, or add a rep — and applies it to
  the STORED protocol, never to a plan the client sent back. Refused, with the
  reason, when the result would no longer be a plan; the gate is the same one
  the drop picker uses (`protocolFirstError`, now shared), so the two can
  never disagree about what "still a plan" means.

  The rules that keep it honest are deterministic and pinned by 41 bars
  (`npm run check:edit`): server-owned fields in a patch are ignored, never
  trusted; any edit other than prose deletes the rep's `how_to` — it described
  the old rep, and a counts-as-done saying "40 minutes" after the user set 20
  is a fabrication on screen; a number the user typed cites `derived_from:
  ['user']` (a new legal citation — the sheet says *"you set this number
  yourself"*) and drops any assumption; a session-attached rep's days are
  locked, because the session repair would silently revert them; days win
  over per-week.

  Migration 0018 writes three things down the server never recorded: the
  plan **as generated** (the pricing baseline), the odds of the **current**
  plan (NULL = stale, and the reveal shows no number that does not describe
  the plan), and the chosen pace's odds at generation — an edited plan's
  **ceiling**: it can match the coach's design at that runway, never
  out-price it. `protocols.kind` lands for the per-rep drop's cap fix.
  Client plumbing (`applyEdit`, `oddsStale`; an unpriced plan locks with no
  odds, which the server already treats as a fine state) is in, unused.
- **The plan on the reveal is editable.** The cousin's underlined item —
  *"do you want Qleck to build your protocol or do you want to build it
  yourself?"* — answered as an editable plan rather than a blank canvas. Tap
  a rep and its row becomes a form, in place: title, Do it / Amount / Minutes,
  the target, seven day toggles or a per-week stepper, details. **+ ADD A
  REP** at the foot of a phase opens the same form empty. One rep at a time;
  Save goes to the server as one op, and a refusal comes back with Qoach's
  reason in amber while the form stays open.

  Honest by construction: a rep that follows a session shows *"Follows your
  run days — change the session, not the rep"* and no toggles, because the
  session repair would silently revert them. A change to the work itself
  turns the odds chip into **— UNPRICED** and the bottom bar says *"Changed
  reps aren't priced yet — this locks without odds"*; a details-only edit
  changes nothing about the number. A drop's re-price does not un-stale an
  edited plan — it priced the drops, not the edits — and the assumption-fix
  box warns that a rebuild throws hand edits away. The affordances finally
  have a line under the summary: *"Tap a rep to change it · × drops it and
  re-prices."*

  Server: re-saving a rep with nothing changed is not a change (the editor
  re-sends the whole form; `check:edit` is 43 bars now). Pricing an EDITED
  plan is the next, gated step — until it lands, a changed plan locks with no
  odds rather than the number of the plan it used to be.

---

### Backend · 11 Sep — measurement before speed (speed plan, step 0)

No build. The owner asked for a faster coach without thinner plans; the
research (two agent workflows, 11 Sep) found that every latency number the
app had ever quoted was inferred from gaps between ledger rows, and that the
wait screen's "26s mean, a third over 40s" was calibrated on validator
retries rather than first builds. So the first step is a ruler.

- **Every model call now records how long it took.** Migration 0019 adds
  `ai_requests.duration_ms`, written in `callModel` on the success path AND
  on the provider-failure row, so a call that dies is a number rather than a
  missing row. Applied locally and to production; the worker that writes it
  is deployed.
- **`npm run latency`** (from `backend/`, read-only, `--local` /
  `--synthetic` / `--days N`) prints the five numbers the speed plan is judged
  by, before and after every step: per-kind duration percentiles (with the
  old gap proxy beside them, labelled), first-attempt validation rate, the
  fast-path rate (the accepted plan IS the background draft), verdict-to-
  accept time, and what the validators rejected — bucketed on the
  validators' own templates with every quoted string masked, so no step
  title, id or user text is ever printed.
- **The production baseline, last 21 days.** Fast path **5 of 38** saves
  (13%). First attempts **52% invalid** (163 calls); attempt 1 62% invalid,
  attempt 2 72%. Gap-proxy protocol p50 15s / p90 75s; verdict p50 8s / max
  10s; verdict-to-accept p50 68s. Of **443 rejected lines, 385 (87%) are one
  mechanical category**: a step's days or per-week disagreeing with the
  session it is attached to ("per_week N exceeds its session's N days" ×192,
  "days (…) must equal its session's days (…)" ×194). Conditional steps
  without a session are next at 26. Everything else is single digits. That is
  step 4b's target, named by data rather than by guess.
- **The first measured durations** (two harness runs, 102 protocol calls):
  protocol **p50 28.8s / p90 59.5s / max 76.4s**; verdict_turn **p50 5.8s /
  p90 11.0s**; every interview-side call (safety, classify, extract, coach
  turn, audit) p50 1.0–1.8s. First attempts 43% invalid in the harness. The
  wait screen's "usually about half a minute" survives; "longest measured: 75
  seconds" turns out to be right by accident (76.4s). The 40-second line does
  not: p90 is 60s, and the common case is one call of ~29s.
- **The harness bar the 9 Sep band change had broken is reconciled.** The
  own-plan bar demanded 1–2 questions while `interviewBand` deliberately gives
  a thin plan 2–4; the bar now reads `interviewBand` itself, and the two
  own-plan fixtures (both three-line plans) expect 2–4. Both runs: PASS.
- **Two baseline runs archived** under `backend/harness/baselines/` (console +
  report committed; the 400KB protocol dumps stay local like
  `last-protocols.json`). Ledger cost **$0.87 + $0.89 = $1.76**, an upper
  bound: the ledger prices at flat rates while 81–86% of input tokens were
  cache hits. Cumulative research spend so far: $1.76 (cap $20 before asking).
- **The noise floor, now known.** Neither run was fully green. Run 1 failed
  two bars, run 2 a third, each on ONE fixture, none repeated:
  `lose-10-lbs-range` phrased its deficit past the "energy" regex,
  `inj-sysprompt` reached a feasible verdict without a full pace ladder,
  `benchpress-2x` asked one question with under two chips. Run 2 also lost
  one revision fixture to a 502 when `wrangler dev` recycled (excluded from
  scoring by the harness's own rule). Every later paid gate is read against
  this: one flaky bar per run is HEAD's normal; the same bar failing on the
  same fixture twice is a regression.
- Dev-only: the local D1 migration journal had stopped at 0013 while the
  tables from 0014–0016 existed, and 0017–0018 had never been applied
  locally. Journal repaired, 0017–0019 applied; `npm run migrate:local` is
  clean again. A `qleck-api-dev` entry in `.claude/launch.json` runs the
  supervised dev worker for harness runs.

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
