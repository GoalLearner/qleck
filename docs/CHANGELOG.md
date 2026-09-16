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

### Build 33 · 11 Sep — the plan is written before you ask for it (speed plan, steps 2–5)

The measurement (step 0, above) put the problem in one number: only 5 of 38
saved plans had taken the instant path. The draft the coach writes in the
background after the verdict was running inside `ctx.waitUntil`, which
Cloudflare cancels about thirty seconds after the response — and a plan call
is 29s at the median, 60s at p90. Most drafts died mid-sentence, invisibly,
and any draft that needed a validator retry could never land. Then "Build my
plan" started a fresh 25–100s generation inside a request the phone times out
at 60s.

- **The draft is a durable job now.** The verdict enqueues it on a Cloudflare
  Queue (`qleck-draft-jobs`, created by the owner; migration 0020
  `protocol_jobs`) and a consumer with no response to be cut off from runs
  the unchanged three-attempt generation to completion. One job per
  (session, epoch); a pace switch mints a new epoch and the old job's result
  lands nowhere (the same compare-and-swap the old draft used). The draft
  CLAIM from build 31 is honoured everywhere, so a consumer and an
  in-request build can never write the same plan side by side. The consumer
  holds a 60-second lease renewed every 10 seconds; a consumer that is
  killed frees its claim inside a minute, a lost lease aborts the model
  call, a D1 hiccup on a renewal does NOT (it keeps going until the lease
  would genuinely have lapsed), each call has a 120-second budget, and
  between attempts it asks whether anyone still wants this plan. The
  AI kill-switch covers the queue's backlog. Account erasure deletes the
  job with the session, and a consumer whose account vanished mid-generation
  de-identifies the ledger rows it wrote afterwards.
- **The app asks asynchronously (build 33).** "Build my plan" answers with
  the plan when the draft is ready — zero model calls, ~15ms measured — or
  with *building* and a job the app polls every 2.2 seconds (GET, quota-
  exempt, self-healing on the server under a kick cap). The wait screen
  reads the JOB, not the clock: *"Your plan is in line to be written"*,
  *"Writing your plan"*, *"The first draft didn't pass Qoach's checks.
  Writing another."* — every line a stored fact. The "40 seconds" and "75
  seconds" lines are gone; they described the retired in-request build. On
  the verdict page the poll keeps going after a born-failed sim and, only
  for exactly the pace on screen, shows **YOUR PLAN IS WRITTEN — OPENS
  INSTANTLY** (or **THE DEAL IS WRITTEN…** on a counter-offer). A job that
  fails three drafts shows the reason and **Retry**, which starts a fresh
  job — at most three failed jobs per goal, then the daily-limit copy.
  Fixing an assumption now rebuilds the pace and side that were built (it
  used to fall back to steady), and the attempt build no longer sends a
  stale null for your own guess. A build-32 install against this server
  still builds: it waits for the job's draft and accepts it, and re-claims
  the build for itself only if the consumer died or gave up.
- **The correction prompt tells the truth (step 4a).** On a retry the model
  used to be shown its emission AFTER the repairs — with a malformed how-to
  already deleted — and then told the step "needs a how_to". It now sees
  exactly what it wrote, and the phase-1 how-to rule it broke by name
  ("gist is 140 chars, must be under 100"). Prompt version 29 → 32 (v30 and
  v31 had shipped unbumped); the cold open was re-captured: 2% as asked,
  82% for the counter-offer.
- **Days win (step 4b).** A step that names mon/wed/fri and says `per_week:
  2` is corrected rather than rejected — the one mechanical rejection left
  after the 6 Sep session repair (nine in one harness day). The big
  "step-vs-session" category in step 0's 21-day readout turned out to be
  pre-6-Sep; since then the top rejection is provenance — a number with no
  citation — which no repair can honestly fix. That is step 6's prompt
  experiment.
- **The harness measures the durable path now.** `run.mjs` builds with
  `async:true`, follows the job, then accepts — one job of at most three
  attempts per fixture, exactly what the in-request build was. The legacy
  branch had let it re-claim after a failed job and score six attempts as
  one valid plan. `npm run smoke:job` drives one goal through the real
  queue against a live worker.
- **The adversarial review** (28 agents, 4 lenses, 2 refuters per finding)
  confirmed four defects and one already-fixed one; all four are fixed
  above (the D1-error-is-not-a-lost-lease case, the kill-switch, the lanes-
  on guard on the async branch, the erased-mid-job ledger rows).
- **Paid runs, ledger (an upper bound — 81–86% of input tokens are cache
  hits):** step-2 regression $0.60; step-3+4 chain (smoke, recapture,
  harness, calibration) $1.09; smokes ~$0.05; final regression $1.21 (with the four-fixture re-run).
  With the two baselines ($1.76): **$4.68 of the $20 ask-first cap.**
  Bars: step-2 run lost `protocol valid` to the legacy branch's 45-second
  wait (fixed); step-3+4 run lost it to one physique fixture on the six-
  attempt legacy scoring (the runner no longer takes that path); final run
  10 of 12 protocol fixtures on the first pass, plus the two known-flaky bars on the same two fixtures as the baselines. The four behind those bars re-run alone: chips and pillars clean, `pushups-30` done after two rejections, `lose-weight-moderate` a genuine three-strike (the sleep pillar and a conditional step, three times — the model, on the same attempt budget the in-request build had), and `lose-10-lbs-range` a job the local queue simulator never delivered while three other builds ran, which the heal then wrote off as "lost" — so the unpicked window is three minutes now and a late delivery for a "lost" job still builds it. Production queues deliver concurrently; the local simulator does not. Calibration on the marathon-3w arm: 82 / 82 / 82 (sd 0)
  where the worker answered; final arm 80 / 82 / 82 / 84 (mean 82, sd 1.6) on the four runs that reached the worker — the other two hit the supervisor recycling it after the long run.
- **Deployed** (worker d0bdd144, migration 0020 applied, queue bound 1 producer /
  1 consumer). Production smoke after the deploy: the live consumer wrote the
  draft 38.7s after the verdict; the accept took 301ms with no generation.
- Not done, on purpose: the lanes simulation is still off; the legacy
  synchronous branch stays until the ledger shows a week without build-≤32
  traffic (step 6 vi); no prompt text changed.

### Backend · 11 Sep — the first attempt passes more often (speed plan, step 6i)

No build. With the draft now written before the tap, the wait a user still
feels is the share of first attempts the validators send back — 43–52% at
the baselines, each retry a full ~30-second call. The step-0 readout said
what they reject: numbers with no citation, on steps and on milestones, and
an assumption on a key the interview had already collected.

- **A paired experiment, not a harness roll.** A harness run builds twelve
  plans, too few to tell two prompts apart. `node harness/genreplay.mjs`
  clones stored synthetic sessions (same goal, interview, answers, verdict),
  rebuilds them through the real durable job under whatever the worker is
  running, and counts what the validators did to the first attempt;
  `--seed` replays exactly the sessions an earlier arm used. Twenty
  sessions, the same twenty in each arm.
- **Prompt v33.** `derived_from` is a REQUIRED field on every step and
  milestone in the tool schema (empty only where there is no number), and
  the protocol prompt ends with a pre-emit checklist of the validators that
  reject a whole plan: cite every number, no assumption on a collected key
  (a range is a value — use its midpoint), session days copied exactly,
  the five physique pillars, no warm-up steps. No other prompt text changed.
- **Measured on the same 20 sessions:** first attempt valid **7 → 13 of 20
  (35% → 65%)**; mean attempts 1.8 → 1.55; median call 26.5s → 24.2s.
  Paired: 8 sessions flipped invalid→valid, 2 the other way. Step-level
  "no citation" rejections went 8 → 0; the range-assumption lines 6 → 3;
  milestone "no citation" only 10 → 9 — those are plan-structure digits
  ("twelve sessions", "11pm", "five nights") the validator counts as numbers
  and the model does not, the next pass's target.
- **The gate:** cold open re-captured (2% as asked, 84% countered); harness
  ALL BARS CLEAR — the first fully green run of the day, 12 of 12 plans, 619s wall on the durable path; calibration on the marathon-3w arm 82 / 82 / 82 / 82 / 82 / 82 (sd 0, no errors).
- **What the model arm needs, learned for free:** both `deepseek-flash` and
  `deepseek-v4-pro` refuse a forced tool call while thinking is on
  ("Thinking mode does not support this tool_choice"); the pipeline only
  works because `deepseek-chat` is the non-thinking alias. Pro answers a
  forced tool call once `thinking: {type: 'disabled'}` is sent. Pro's peak
  rate is 4.4× flash on a cache miss and 3.3× on output. Not switched.
- **Paid:** baseline arm $0.39, candidate arm $0.34, gate $0.61;
  cumulative $6.02 of the $20 ask-first cap.

### Backend · 11 Sep — v34, a 16k ceiling, and the first turn in parallel (speed plan, step 6i/ii/iv)

No build. The second pass on the first-attempt rate, plus two levers that
cost no content.

- **Prompt v34.** The milestone line now names what the validator actually
  counts — any numeral, week counts and clock times included ("12
  sessions", "11pm", "5 for 5") — and where each kind cites (the collected
  key, `goal_text` for the goal's own bedtime or deadline,
  `standard_practice` for the plan's own structure). The range line says
  "set NO assumption" outright. Same 20 paired sessions: first attempt
  valid 13 of 20 again (65%), but **every one of the 20 built** (v32 19,
  v33 18 — the three-strikes are gone) and mean attempts 1.55 → **1.4**;
  milestone "no citation" rejections 9 → **0**, range-assumption 3 → **0**.
  What the validators still send back on a first attempt is two content
  rules the model breaks in spite of the checklist — a warm-up as its own
  step (4) and a physique plan without its protein step (3) — seven lines
  across 20 sessions, down from 35 at the baseline. Diminishing returns;
  the next lever there is the judge, not the validators.
- **The emission ceiling is 16,384 tokens** (`PROTOCOL_MAX_TOKENS`, was
  8,192). A plan averages ~7,100 output tokens and the long ones were cut
  mid-JSON, which the validators reported as "protocol is not an object" —
  seven times in one harness day, and a revision of a long plan could fail
  three times running (`rev-too-hard` 502'd in every regression). The flash
  alias accepts 16k (probed); the consumer's 120s budget covers it at the
  measured ~245 tokens/s.
- **Safety and the domain classifier run at the same time** on the first
  turn (`preclassify`): two ~1s calls become one wait, and nothing is
  written until safety has passed — a refused goal drops the classification
  (one extra call, ~$0.0005). Roughly a second off the first question.
- **The gate:** cold open re-captured (3% as asked, 82% countered); harness 12 of 12 plans, 9 of them on the first attempt, all three revision fixtures green (`rev-too-hard` for the first time today — the ceiling), one bar lost to the known-flaky chips fixture `benchpress-2x`;
  calibration 82 / 80 / 84 / 82 (mean 82, sd 1.6) on the four runs that reached the worker.
- **Paid:** v34 arm $0.35, gate $0.64; cumulative $6.96 of the
  $20 ask-first cap.

### Backend · 11 Sep — the pro model, measured and declined (speed plan, step 6i)

No build. The last of step 6's questions: would `deepseek-v4-pro` on the
coach role pass the validators more often than flash? Same 20 paired
sessions, same v34 prompt, only the model changed (`GEN_MODEL` on the dev
worker; `thinking: {type: 'disabled'}` now sent on every DeepSeek call,
because both models refuse a forced tool call while thinking is on).

- **Pro:** first attempt valid 14 of 20 (70%, one more than flash's 13);
  but only 18 of 20 built (two three-strikes, where flash built all 20);
  mean attempts 1.4, the same; median call **48s against 26s**, p90 87s
  against 55s; and the plans were **half the length** — 3,814 output
  tokens against 7,107 — which on this plan's rules is thinner how-to
  sheets, not better ones. **$0.50 for 27 calls** at honest pro rates,
  about three times flash per plan.
- **Verdict: stay on flash.** The remaining first-attempt misses are the
  same two content rules on either model (a missing protein or bedtime
  step, a warm-up as its own step). The lever is not the model.
- **The ledger prices honestly now.** Per-model rates with the cache-hit
  discount (DeepSeek bills a hit at about 1/50 of a miss, and 81–92% of this
  pipeline's input tokens are hits). Rows written before this evening were
  priced flat and read 1.6–3.2× high; `npm run latency` and the changelog's
  spend figures before this entry carry that overstatement.
- **Not started, by design:** a judge-measured compactness pass (the how-to
  is ~46% of a 7,100-token emission; the owner's call is that content stays
  as designed); the legacy synchronous branch comes out after both phones
  have run build 33 for a week.
- **Paid:** pro arm $0.50 plus a $0.02 false start on flash. **Day's total
  on the ledger: about $7.50 of the $20 ask-first cap** (the pre-evening
  rows being an upper bound).

### Build 34 · 13 Sep — the intake, redesigned (Ask Intake, turn 3a)

The Claude Design handoff *Qleck Ask Intake* carried three turns; the owner
chose turn 3a — "no sheet, the date lives on the screen" — with turn 2's
plan mode behind the link, and dropped the suggestion chips.

- **The date is on the screen.** Under the goal box, **BY WHEN?** is four
  pills (2 weeks · 1 month · 3 months · 6 months) that print their date
  inside themselves when picked ("1 month · Oct 13"), **Pick a date** — a
  month/day wheel from tomorrow to 52 weeks out, headed "Saturday · 34 days
  out" — and a dashed **Qoach decides**, which is the default. The old mono
  "+ BY WHEN?" toggle and its weeks stepper are gone.
- **What the coach reads is unchanged in form, and never longer than the
  date.** The pick folds into the goal as the same "— in N weeks." phrase,
  now FLOORED: 1 month is 4 weeks, 3 months is 12, a date 51 days out is 7.
  The plan can come in a few days early; it can never run past the date.
  The wheel stops at 52 weeks because that is the longest runway the fold
  states. `check:timeline` has the date helpers pinned (45 fixtures).
- **A quieter screen.** Goal box, the date, a full-width **Ask Qoach** that
  stays dim until the goal has three characters (a tap while dim shakes the
  box), and "I already have a plan →". Left-aligned headline, no ambient
  glow, no cycling ghost prompt, no suggestion chips, no "AI COACH" pill.
  Not in the design but still needed: onboarding's *Skip for now* and the
  new-goal modal's *Cancel* moved to the top right of the Qoach header.
- **Plan mode is its own screen state.** "I already have a plan →" swaps
  the headline to **Bring the plan you've got.** ("Qoach won't rewrite it —
  it keeps you honest to it."), shortens the goal box, adds the plan box, and
  "← Start from a goal instead" swaps back with both drafts kept. Ask Qoach
  needs the goal and the plan; the CTA stays "Ask Qoach" as designed (it
  used to flip to "Review my plan").
- Two palette tokens the design needed: `surfaceRaised` (the wheel sheet) and
  `textStrong` (unselected pills), both themes. `goalSuggestions.ts` is no
  longer imported; it stays in the tree in case the chips come back.
- Checked in the web preview at phone width, dark and light: typing, a span
  pill, the wheel (month change, day, Set), plan mode, the dim-button gate,
  and the submit payload with the network intercepted — `"Run a 5k without
  stopping — in 7 weeks."` plus the plan, zero model calls.

### Build 35 · 15 Sep — the ticks that never arrived

No check-in from any account had reached the server since 8 Sep, while both
testers had been ticking reps every day. The reps were never lost — they were
stuck in the queue on the phone — and two defects put them there.

- **The server refused to save a plan shape it had generated itself.** A rep
  tied to a session (a lift, a run) kept a lower weekly count than the
  session's days after the coach's own repair: "2 days, 1 a week". The plan
  validator rejects that, so `POST /goals` answered 400 when the plan was
  locked. Two production plans were locked in that shape (6 and 12 Sep);
  neither goal ever reached the server. **Server, deployed 15 Sep (worker
  f231826d):** the repair now sets the count from the session's days, the
  coach re-checks the plan after its repairs, and every place that saves or
  reads a plan heals that shape instead of refusing it.
- **One refused tick froze every tick behind it.** The phone parked the
  refused goal (still shown, never retried), so every tick on it came back
  "goal not found" — and the check-in queue stopped at the first refusal,
  treating it as "still offline". From that tick on, nothing else ever sent,
  on any goal. And after a refresh, Today showed only what the server had, so
  banked reps looked gone. **Build 35:** a refused tick is held with that
  goal's later ticks while every other goal's ticks send; nothing is ever
  dropped. Goals parked by older builds get one more try, which the server
  fix now turns into a save, so the stuck ticks go out with their original
  dates, in the order they were tapped. Today keeps showing queued ticks
  after a refresh.
- **A tick tapped while another was sending could be erased.** The queue was
  read once per flush and its own copy written back after each send, so a tick
  queued mid-flush was overwritten; the goal queue had the same race with a
  plan locked mid-flush. Every queue change now goes through one lock and the
  drain re-reads the queue before each step.
- **Until build 35 is installed: don't sign out, don't use "Reset this
  device", don't delete the app.** Each of those erases the queue that is
  holding the stuck ticks. Ticking as normal is fine — it queues.
- Checks: `check:outbox` (20 bars on the real drain loop: held vs later,
  order within a goal, a tick queued mid-send survives, parked-goal epochs),
  `check:recovery` (live worker, no AI: recreates the stuck phone, reproduces
  the old stall, then rescues the parked goal and lands all 7 ticks with their
  dates), `check:session` +5, `check:frequency` +3, `check:goals` +2.
  Production job smoke after the deploy: draft 30.1s after the verdict,
  accept 345ms.

### Unreleased · 15 Sep — the choice comes first

- **"Where are you starting?"** The testers' note asked for a real choice
  between Qoach building the plan and bringing your own for Qoach's opinion.
  Both paths already worked, but the second hid behind a 14pt link under the
  button. A new goal now opens on Ask Intake turn 1c: **I have a goal** ("Tell
  Qoach what and by when. It builds the plan.") and **I already have a plan**
  ("Paste or type it. Qoach keeps you honest to it."), with "Your goal is sent
  to our AI coach to build your plan." at the foot. Each card opens the intake
  it names; a ‹ in the header returns to the cards without losing what was
  typed. The link is gone. Regenerating an old goal skips straight to the
  goal intake. The design's "OR STEAL ONE" list stays out (dropped 13 Sep).

- **One turn, one write.** Each interview turn used to reach the database two
  or three times: the structured answers were saved before the model was
  called, the question count was incremented relative to whatever was stored,
  and the transcript was written afterwards. Two real costs — a turn that
  failed after the extract left the saved answers ahead of the conversation,
  and two sends of the same answer (a double tap, a retry on a slow phone)
  each counted a question, so a three-question interview could report five. A
  turn now computes everything in memory and commits **once**, guarded on the
  transcript it was computed from. A commit that loses that race replays the
  turn the winner produced when it carries the same answer, and says the
  conversation moved on when it does not; the background draft starts only
  after the verdict is committed. Proven live: two simultaneous sends of one
  answer came back as the same question, and left one entry.
- **Every question now records what it was asked with** — the answer chips as
  delivered, and the structured state Qoach chose it from. Nothing new reaches
  the model: every reader of the transcript still sees only the question, the
  why and the answer. This is what will make changing an earlier answer
  honest, and it is what lets a duplicated send be replayed today.
- **Go back and change an answer** (server half). `POST /coach/sessions/:id/
  rewind {index, answer}`: question *k* keeps its text and takes the new
  answer, every question after it is discarded, and the structured state goes
  back to the snapshot that question was chosen from — so the turn that runs
  next sees exactly what the original one saw. Three changes per interview
  (each spends two model calls); the question on screen is answered, not
  changed; a session that has reached its verdict can't be rewound, but a
  *retried* change that already produced the verdict replays it instead of
  being told the session is closed. Migration 0021 adds the counter, which is
  incremented inside the same guarded commit as the turn — a change that loses
  a race counts nothing. `check:rewind` (43 bars) and a live `smoke:rewind`
  (21 bars: truncation, replay, two-at-once, the refusals, the cap, and the
  interview still reaching a verdict afterwards).
- **Tap an answer to change it** (the app half). From the third question on,
  every earlier answer carries a quiet CHANGE. Tapping one asks "Change this
  answer? The questions after it will be asked again", and says how many
  changes are left. Say yes and the thread ends at that question with its
  original chips back and the old answer already in the box — what the change
  throws away is visible before it is sent, and "Keep my answer" puts it all
  back, including whatever was half-typed for the question on screen. Send a
  different answer and Qoach carries on from there. When Qoach keeps an answer
  (the three are spent, or the conversation moved), the reason is one amber
  line above the box rather than an error screen: the conversation is still
  there, it simply did not change.
- **A retried answer no longer answers the wrong question.** The app now says
  which question it is answering. Without that, an answer whose response was
  lost on the way back (a dropped connection on a slow phone) was re-sent by
  Retry and applied to the NEXT question. Now the server recognises it and
  replays the turn it produced. Older builds are unaffected.
- **Tick a rep off the plan** (server half). The testers asked to choose what
  they will and won't do without being forced. The old drop picker refused any
  drop that cost a "physique pillar" — on a weight goal that is most of phase
  1, so the honest answer to "I can't do this one" was *no*. Now the only
  refusal is a plan with nothing left in it, and the cost is **stated**: the
  app writes one line naming the pillars that came out, or the phase that has
  nothing left (its weeks join its neighbour; the plan keeps its length and its
  milestones). The line is written from stored facts, never by the model —
  asked to describe a cost, a model sells it.
- **The stored plan stays whole.** Re-pricing used to replace it with the
  trimmed version, so ticking a rep back on meant rebuilding the plan. The
  price now records *which set it is the price of* (migration 0022), so
  ticking one back on is a re-price — and ticking everything back on is the
  plan as designed at its own number, with no model call at all.
- **A drop can no longer RAISE the odds.** The clamp compared against the
  verdict's steady number, so on a sprint, a custom runway or an own-plan
  review — where the plan actually built is priced lower — removing work could
  come back with a higher number. It is now clamped to the odds of the plan
  Qoach built, and to the last price whenever the new set drops everything the
  last one did and more.
- **Ticks on the plan screen** (the app half). Every rep carries a tick, all
  on. Unticking one takes its later versions with it — the same habit in
  phase 3 is a different rep, and "protein, but only in weeks 1–5" is almost
  never what anyone means — with "Also out of phases 2–4 · **keep those**"
  one tap away. A folded phase header says "6 of 7 reps". The last rep
  standing cannot come off.
- **The bottom bar owns the state.** While the plan on screen is not the plan
  the number describes, **Lock it in is replaced** by "Re-price — N reps out"
  and the odds chip reads "— RE-PRICE": a plan can never lock under a number
  that belongs to a different plan, and seeing the cost is the decision.
  After a re-price the delta (80 → 73) and the cost line sit right above the
  button. If Qoach cannot price it, the reasons are there with Undo changes
  and Lock without odds — the choice is never thrown away.
- **A corrected assumption keeps your ticks, and its plan is priced.** The
  rebuild renumbers every rep, so the choices are carried over by title. It
  also used to leave the rebuilt plan marked unpriced, so a plan Qoach had
  just priced showed no number and locked without one.
- **"Not for me", after the plan is locked** (server half). The same choice on
  the other side of the lock, with stricter rules because the plan has a past
  now. The rep comes out **from this week on**: it stays in the phase being
  lived, marked, so the weeks already banked still expected it and the days
  banked against it stay receipts; in phases that have not started it is
  simply gone, and a phase left empty folds into its neighbour. The only
  refusal is having nothing left to do between now and the end — "nothing is
  on until week 5" is allowed. The plan is re-priced against the goal's own
  odds (so it can only cost), and when Qoach cannot be reached the rep still
  comes out with the goal's odds **cleared** rather than left describing a
  plan that no longer exists.
- **Taking a rep out is not an adjustment.** It appends a plan version like
  Adjust does, but of kind `drop`, so it no longer spends the one adjustment a
  goal gets per day.
- **Qoach never sees a retired rep** — it would coach it back in. Adjust,
  extend and maintain are shown the plan without them, and the markers are
  restored afterwards, so a revision cannot quietly resurrect a rep the user
  took out or rewrite what a lived week expected.
- **"Not for me" on a rep you are living** (the app half). Every rep on Today
  and Goals opens its sheet now, how-to or not — that is where it lives, under
  Got it / Tweak. It asks once ("From today on. Days you already banked stay
  banked, and Qoach re-prices the plan"), offers to take the same rep out of
  the later phases too, and answers with the new number and what it cost:
  "Out of the plan. 80% → 68%". When Qoach cannot be reached the rep can
  still go, with the goal's odds cleared.
- **The past stays true on screen too.** A retired rep leaves today's list and
  the strips from its week on, its later days go blank in the Ledger rather
  than missed, the week it came out in expects only what it banked (so a drop
  can never lower adherence or un-earn a milestone), and Goals shows it struck
  through with "Dropped in week N". The days already banked keep counting.
- **The end of a plan stops reading wrong.** "1 weeks · 1 phases" was
  reachable everywhere a duration is printed — and the first plan a tester can
  finish in a day is exactly the one that says it. Every refusal of "keep it
  going" said the same sentence, including the ones that have nothing to do
  with Qoach (five goals already running, the daily limit, a plan graduated on
  another device), so people were told to try again at things that could not
  work. And a Ledger week after the plan ended claimed the plan "hadn't
  started yet". All three now come from one small module with its own bars
  (`check:copy`).
- **A plan that ends overnight says so without a relaunch.** The day was read
  on render, so nothing rolled it at midnight: a finished plan kept showing
  yesterday's reps until the app was killed. It now rolls on a timer and
  whenever the app comes back to the foreground.
- **Goals knows a plan is finished.** A PLAN COMPLETE chip, "N weeks, done"
  instead of "week 6 of 6", **See how it went ›** into the graduation screen,
  no Pause on a plan there is nothing left to pause, and the header counts
  what is actually running ("Nothing on the clock — see how the last one
  went").
- **The AI ledger says whose call it was.** `ai_requests.user_id` has existed
  since the schema froze and was never written, which broke two promises at
  once. Account deletion matched nothing in the ledger, so the feedback typed
  into Adjust — which logs with the user id in the DEVICE column — survived
  deleting the account until the 30-day sweep, against the standing rule that
  erasure keys on links actually written. And the daily per-account limit
  could never bite, because a signed-in caller was metered by comparing a user
  id against the device column: only the 450/IP rail was ever real. Rows carry
  the account now, erasure clears both shapes, and the limit counts the
  account and the device in front of you. Migration 0023 indexes it.
  `check:quota` (11 bars — the counting query is lifted out of the source and
  run against a real database, so the AND/OR precedence is proven, not
  assumed) and four more in `check:purge`.
- **Two tester tools, behind the seven taps that already hide the device
  reset.** The end of a plan is the part nobody can reach while testing,
  because it is six weeks away. **Start a 3-day test goal** locks a one-week
  plan that started four days ago — two flexible reps, no odds, no AI, no
  coach session — through the ordinary lock path, so everything after it is
  the real thing. Flexible on purpose: a pinned rep would report the
  back-dated days as misses. **Finish this plan now** opens the finish screen
  for a plan that is still running, scored only on the days the plan actually
  asked for (a pinned rep its scheduled days, a flexible one its share of the
  week), with no confetti, "N milestones were still ahead", and no offer to
  extend. Neither tool writes a check-in, and nothing happens until you choose
  on the finish screen itself. `check:test-goal`, 18 bars.
- **A retried graduation is the same graduation.** The app minted a fresh id
  on every press, so a "keep it going" whose response was lost and then
  retried wrote a SECOND plan; and the replay check sat behind the AI
  kill-switch and the daily quota, so the retry could also be refused as the
  daily limit for work that had already been done. The id is now held by the
  screen until the choice succeeds, and the server answers a replay from
  stored ids before any gate. The graduation call also carries the server's
  error code now, which is what lets the named copy above actually name
  things.
- **"Keep it going, lighter" works on short plans.** A finished plan could
  only maintain for twice its own length, but the maintenance prompt asks for
  4-12 weeks — so a plan of six weeks or less could never graduate at all:
  every attempt came back as "the coach hit a snag". The cap is now a floor of
  12 weeks and a ceiling of a year, and a plan longer than that is **trimmed**
  rather than refused (whole phases past the line go, the phase it falls
  inside ends there, milestones with them). `check:graduation`, 14 bars — and
  the three pure plan-shape functions moved to `protocolSchema.ts` so they can
  be checked without a Worker runtime at all.
- `check:ticks` (18 bars) and `check:drop` (60 bars, including 3,600 random tick sets over the twelve
  plans of the last harness run: none of them can produce a plan the
  validators reject) and a live `smoke:drop` (13 bars).
- Regression, full harness against the local worker: 12/12 protocols valid,
  3/3 revisions past-preserving, no leaks, no repeated questions, question
  counts in band, 468s wall (the fastest run recorded — one less write per
  turn). The two red bars are the known flaky pair on this suite (a pace
  ladder on `lose-weight-moderate`, the "what does the scale say" question on
  `pushups-30`), both seen on unmodified code in earlier runs and on other
  fixtures. Archived under `backend/harness/baselines/2026-09-15-3a-regression/`.
  Spend today $0.29 of the $5 the owner approved for this list.

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

- **A revised plan can leave a rep on days its session does not have.**
  Found on 15 Sep by the randomised tick bar: of the twelve plans the last
  harness run produced, the two that were also revision sources each carry a
  rep whose days disagree with its session ("kit by the door the night
  before" on sun/tue/thu against a mon/wed/fri run session). Generation runs
  `sessionErrors` and would never ship it; `reviseProtocol` and the
  graduation merge validate the schema only, and they rewrite the later
  phases — which is exactly where every mismatch is. **Nothing visible
  breaks**: the app reads a step's own days and only falls back to the
  session's when the step has none, so the rep renders on the days the coach
  meant. The two consequences are that the plan editor locks those days (it
  treats an attached rep's days as the session's to set), and that anything
  gating on `sessionErrors` must be differential — re-pricing a tick is, and
  says so. Left alone deliberately: the honest repair is to DETACH such a rep
  rather than move it onto days the coach did not choose, and that is a
  judgement about model output, not a mechanical fix.
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
