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

- `repriceTrimmedProtocol` runs 2 of the 9 protocol validators, so the
  commitment picker can produce a plan that skipped checks the normal path
  enforces. Same family as the bug that cost a user their protocol on 1 Sep.
- The fabrication guard corroborates against *extracted* answers, so one
  incidental word can license a claim.
- `/me/export` omits the interview answers. `your_own_odds` ships; the rest of
  `goal_outcomes` does not.
- Play internal upload never done.
