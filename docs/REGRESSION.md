# Manual regression checklist

The standing net (ROADMAP **P2b**). Run it on **web** (`npm run web`, the
dev preview talks to the local worker) and on a **device via Expo Go /
TestFlight** before any build you hand to someone else.

The automated checks come first — they are faster and catch more:

```bash
npm run check
```

That runs the temporal-layer fixtures, the protocol-diff fixtures, the
re-forecast fixtures, the milestone fixtures, the **demo-boundary guard**, and
a full typecheck. Backend changes additionally need `cd backend` +
`npm run harness` (16 bars), `npm run check:auth` (30 bars) and
`npm run check:goals` (12 bars) and `npm run check:witness` (17 bars).

> **Scope note.** The Rally-era social surfaces — RSVP, invites, polls,
> cheers, follow, team logging, the 3-step Create — are **dormant**: routes
> removed from the shell (owner call 2026-08-24) and `DEMO_ENABLED = false`.
> They are not in this checklist because the user cannot reach them. If the
> demo world is ever revived (`src/demo/README.md`), restore section 11.

---

## 1. First run, real account

- [ ] Fresh install (or web incognito) opens on the welcome carousel; the
      brand splash holds ~1–1.5s, never a flash.
- [ ] Auth door shows only real doors: **Continue with Apple** (iOS) and
      **Sign up with email**. No Google button, no phone option, no demo chips.
- [ ] Email signup: a code really arrives (owner's inbox), the wrong code is
      refused, the right one advances to the profile step.
- [ ] Username availability reacts live; a taken handle is reported taken.
- [ ] Kill the app between the code and the profile step → reopening resumes
      **at the profile step**, not back at the welcome screen.
- [ ] Signing up on a device that already had goals **keeps those goals**.

## 2. Goal intake and the verdict

- [ ] Type a realistic goal → Qoach asks 3–6 questions, each with tappable
      chips (or an exact-figure ask with no chips, never bucket ranges).
- [ ] No question repeats in different words.
- [ ] Verdict shows the dial immediately, a subtitle, and three read cards
      (going for you / the honest risk / Qoach's move).
- [ ] Pace pills re-price the plan; **OR NAME IT** prices a custom runway and
      a shorter runway never out-prices a longer one.
- [ ] An over-ambitious goal counters (not refuses) and shows both numbers.
- [ ] An unsafe goal refuses with help-seeking copy, never a plan.

## 3. Own-plan review (Tier-2)

- [ ] "+ I ALREADY HAVE A PLAN" opens the commitments box; the CTA becomes
      **Review my plan**.
- [ ] The review asks **1–2 questions only** and the verdict header reads
      **YOUR PLAN, PRICED**.
- [ ] The reveal keeps the user's own commitments; anything Qoach added wears
      the **QOACH ADDED** badge with its reason.

## 4. The protocol reveal

- [ ] Steps carry sensible frequencies; assumptions show "Assumed X — fix"
      and correcting one regenerates the plan.
- [ ] The commitment picker (×) marks a step; **RE-PRICE** either lowers the
      odds or refuses the drop with a named reason. It never raises them.
- [ ] **Lock it in** lands on Today with the plan's reps.

## 5. Today, the daily loop

- [ ] Today lists exactly the reps due today; rest days say so.
- [ ] Checking a rep animates, banks it, and updates the ring + streak.
      Unchecking reverses it (and really deletes server-side).
- [ ] Quantity reps accept a typed number; duration reps show minutes.
- [ ] Week dots are tappable: past days open read-only showing what was
      banked; future days show what is scheduled.
- [ ] Two concurrent goals render as separate labelled groups, no cross-talk.
- [ ] **Airplane mode**: check a rep, kill the app, restore network, reopen →
      the check-in syncs exactly once (no duplicate).

## 6. Missing days (P4)

- [ ] Miss one scheduled day → the gentle "yesterday slipped" banner.
- [ ] Miss two scheduled days in a row → it escalates to the **comeback
      banner** ("the rep after a miss is the one that decides"), and the
      gentle banner is gone (never both).
- [ ] The banner's "make the weeks ahead easier" opens **Adjust** with
      *Too much* preselected.

## 7. Milestones, pause, delete (P4 polish)

- [ ] Banking the rep that carries a week past ~80% pops the **milestone card**
      on Today, once — dismissing it and relaunching does not repeat it.
- [ ] A milestone earned before you updated the app does NOT retro-celebrate.
- [ ] **Pause this goal** (Goals → open a goal) badges it PAUSED on Goals and
      removes its reps from Today; nudges for it go quiet.
- [ ] **Resume** brings it back at the week it left — a goal paused for a week
      still reads "week 2 of 6", not "week 3 of 6".
- [ ] A dropped goal appears under FINISHED; its **×** arms, then ERASE FOR
      GOOD removes it for real (it does not come back on relaunch).

## 8. The witness (P4.5)

- [ ] Goals → open a goal → **A WITNESS** explains what a watcher sees before
      you share anything.
- [ ] **Let someone watch** produces a link; **Send it** opens the share sheet
      on a phone (Copy link on web).
- [ ] Open that link in a browser with no Qleck account (or a private window):
      it shows the goal name, the streak, days shown up, and a fortnight of
      dots — and **nothing else**.
- [ ] It must NOT show: what you typed to Qoach, which days you missed, or any
      of your other goals.
- [ ] **Stop sharing** kills the link — reloading it shows "This link isn't
      active", indistinguishable from a link that never existed.
- [ ] Sharing again gives a NEW link; the old one stays dead.

## 9. Adjust, graduate, archive

- [ ] Adjust proposes a diff before anything is written; **Keep my current
      plan** changes nothing.
- [ ] Accepting applies it, and **past weeks are untouched**.
- [ ] A second adjustment on the same goal the same day is capped.
- [ ] A plan that reaches its end offers the graduation ceremony (extend /
      maintain / close out) and does not rot into a permanent rest day.
- [ ] The Ledger pages back through prior weeks with correct banked/missed.

## 10. Nudges, account, settings (device only)

- [ ] Locking a plan triggers the OS notification prompt — **never** during
      the signup funnel.
- [ ] You → NUDGES: master switch, morning/evening times, per-goal mute.
- [ ] With nudges on, the morning and evening notes actually fire at the set
      times; banking every rep silences that evening's nudge; a rest day is
      silent.
- [ ] Denied notifications show the Settings deep-link, not a dead switch.
- [ ] Appearance light/dark/system changes **both** the coach and app
      surfaces together, immediately.
- [ ] Log out → the login screen; logging back in restores goals and streak.
- [ ] Delete account → everything is gone; the next launch is a clean slate.

## 11. Demo world — *dormant, do not run*

RSVP, invites, polls, cheers, follow, team logging, 3-step Create. Unmounted
since 2026-08-24 and behind `DEMO_ENABLED`. Restore this section only if the
demo world is revived; until then, `npm run check:demo` is what guards it.
