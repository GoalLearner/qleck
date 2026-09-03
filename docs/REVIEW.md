# Store review pack

Everything an App Review or Play reviewer needs, plus the answers to the
console questionnaires. ROADMAP **Phase 5**.

> Two things here are **owner-side and not done**: setting
> `REVIEW_DEMO_PASSWORD`, and the actual submissions. Everything else in this
> document describes shipped behaviour.

---

## 1. Reviewer notes (paste into App Store Connect / Play)

> Qleck is an AI goal coach. You type a goal in your own words; the coach
> asks a few questions, gives an honest feasibility verdict (including
> counter-offers and refusals), and generates a step-by-step plan you then
> live day by day.
>
> **Demo account** — email `review@qleck.app`, password: *(see the private
> note field)*. It signs in immediately and needs no email access.
>
> **Fastest path to the core feature (~90 seconds):**
> 1. Sign in with the demo account.
> 2. Tap **+** in the tab bar.
> 3. Type any goal, e.g. *"Read 10 minutes before bed every night"*.
> 4. Answer the 3–5 questions (tap the suggested chips — no typing needed).
> 5. The verdict appears with a success probability. Tap **Build my plan**.
> 6. The generated protocol appears. Tap **Lock it in** — you land on Today
>    with the plan's first reps.
>
> **Things you may want to check specifically:**
> * *Account deletion* — You tab → **Delete account**. It erases everything
>   server-side, not just locally.
> * *Data export* — You tab → **Download my data**.
> * *Report AI content* — under every verdict and plan: **Report this
>   response**.
> * *Safety refusals* — try *"lose 30 pounds in two weeks by not eating"*.
>   The coach refuses and points to professional help rather than planning it.
>
> The app contains no user-generated content visible to other users and no
> social feed.

## 2. The demo account

Set the secret, once:

```bash
cd backend && npx wrangler secret put REVIEW_DEMO_PASSWORD
```

`POST /auth/login` with `review@qleck.app` and that password mints a real
session against a dedicated account (`backend/src/index.ts`, the review-demo
branch). No client build flag, no mock branch in the funnel — the demo door
is server-side only, so it cannot leak into a normal user's build.

**If the secret is unset the door is closed** and the reviewer cannot get in.
Set it before submitting.

## 3. Age rating

- **13+.** The funnel gates on it: the auth screen requires an explicit
  "I'm 13 or older" confirmation before either sign-in door is tappable.
- We deliberately ask for a **confirmation, not a birthdate**. A date of
  birth is personal data we would then have to store, protect, export and
  erase, and it buys nothing the confirmation does not.
- Consequently there is no age-band-specific model behaviour. Instead the
  **strict threshold is applied to everyone**: the safety classifier refuses
  eating-disorder-adjacent framing (starvation, purging, punishing regimes)
  and anything needing clinical supervision, for every user regardless of
  stated age. Fixture-covered in `backend/harness/fixtures.mjs` (the
  `unsafe` category) with a 100%-refusal exit bar.

Questionnaire answers:

| Question | Answer |
|---|---|
| Cartoon/fantasy violence, profanity, sexual content, horror | None |
| Alcohol, tobacco, drug use or references | **Infrequent/Mild** — quitting-smoking and drinking-less are supported goals, framed as cessation |
| Medical/treatment information | **Infrequent/Mild** — general wellbeing guidance with a persistent not-medical-advice disclaimer |
| Gambling, contests | None |
| Unrestricted web access | No |
| User-generated content shown to others | No |

## 4. App Privacy labels

**Data linked to you**

| Type | Why | Notes |
|---|---|---|
| Email address | Account creation, sign-in, password reset | Only when signing up with email; Sign in with Apple users may use Hide My Email |
| Name, username | Shown in your own app | Optional; blank is allowed |
| User content (your goal text and answers) | To generate your plan | Sent to the AI provider; see §5 |
| Identifiers (device id, user id) | Anonymous accounts before sign-up; abuse and cost limits | |
| Diagnostics (crash reports) | Fixing bugs | `client_errors`, 30-day retention |

**Not collected:** location, contacts, photos, health-kit data, browsing
history, advertising identifiers, payment info. **No tracking**, no third
party analytics, no ads, no data sold or shared for advertising.

## 5. Subprocessors

- **Cloudflare** — Workers + D1 (hosting and database).
- **DeepSeek** — the AI provider that generates verdicts and protocols.
  Goal text and interview answers are sent here.
  *(Note: the roadmap's P5 line says "naming Anthropic as subprocessor",
  written when the provider was Anthropic. The shipped provider is DeepSeek
  — `AI_PROVIDER` in `backend/wrangler.toml`. The shipped privacy policy
  names DeepSeek; if the provider ever changes, `backend/src/legal.ts`
  changes with it in the same commit.)*
- **Resend** — transactional email for sign-in codes.

Retention: AI prompt/response payloads are deleted after **30 days** by the
nightly cron; the request metadata (model, tokens, cost — no user text) is
kept as the cost ledger. Deleting your account erases everything immediately
and de-identifies the ledger rows.

## 6. Compliance surfaces in the app

| Requirement | Where it lives |
|---|---|
| Account deletion (5.1.1(v)) | You tab → Delete account → `DELETE /me` → `purgeAccount` |
| Data export | You tab → Download my data → `GET /me/export` |
| Report AI content (Play AI-GC) | Under every verdict and plan → `POST /ai-reports` |
| Not-medical-advice disclaimer | `CoachFooter`, on every verdict and plan |
| Age gate | Auth screen, gates both doors |
| Disclosure that goals go to an AI | Intake screen and the age-gate line |

## 7. Verification

```bash
cd backend
npm run check:purge     # 17 bars — deleting an account really empties D1
npm run check:auth      # 30 bars
npm run check:goals     # 12 bars
npm run check:witness   # 17 bars
npm run harness         # 16 exit bars over the coach itself
```

Plus `npm run check` at the repo root, and `docs/REGRESSION.md` by hand on a
device before submitting.

## 8. Still owed before submission (owner)

- [x] **`REVIEW_DEMO_PASSWORD` set 2026-09-02** — worker secret, owner-chosen,
      never in a transcript. The door self-provisions: first login as
      `review@qleck.app` creates the identity, so nothing needed seeding.
      Verified live — a wrong password returns the same flat 401 `bad_login` as
      any other, so the demo account cannot be found by probing.

      **The App Review note MUST say how to reach the password field**, or this
      fails review for a sign-in that works. The front door is Continue with
      Apple and the email path is code-based, so credentials alone look broken:
      typing the address into the signup box returns "couldn't deliver" (true —
      Resend can only reach the owner's own address until the sending domain
      lands). Wording:

      > To sign in with the credentials above, tap "I already have an account"
      > on the welcome screen and use the email and password fields.

      Still owed: sign in as the demo account and BUILD ONE GOAL. A reviewer
      landing on an empty Today has to sit through the interview and a live
      model call before seeing the product.
- [x] **Privacy policy + terms LIVE 2026-09-03** — served by the worker
      itself, so there was no domain to buy and no hosting to stand up:
      - https://qleck-api.richmondcampano93.workers.dev/privacy
      - https://qleck-api.richmondcampano93.workers.dev/terms

      Both name the §5 subprocessors, and the privacy page states plainly that
      goal text and interview answers go to DeepSeek. Source is
      `backend/src/legal.ts` — ONE copy, deliberately: a policy in docs/ plus a
      policy on a website is two things that drift, and a policy that no longer
      describes the app is worse than none. Editing the text means a deploy,
      which is the correct amount of friction.

      Contact, legal entity and governing law are constants at the top of that
      file; while any is unset both pages render a red "not final" banner, so
      an unfinished policy cannot quietly look finished. All three are set
      (Richmond Campano, California) — note the contact address is now PUBLIC.

      Still to do: paste the privacy URL into App Store Connect, and link the
      terms from the listing or the EULA field. Not written by a lawyer; a
      professional read is worth the money before the store listing goes live,
      given the health-adjacent goals.
- [ ] Screenshots for both stores. Material that now exists and did not
      before: the cold open's refusal (3% -> 85%), the day-complete card with
      the week ledger unrolled, the odds dial carrying the user's own guess
      beside Qoach's, and a rep how-to sheet.
- [x] First TestFlight upload — Xcode from the MacBook (not EAS; there is no
      eas.json and the owner signs locally). Play internal still owed.
- [x] **Build 15 shipped 2026-09-01** — the first build testers can actually
      sign up on. Build 14 was cut from a stale checkout (`409fbd3`, 30 Aug) and
      had none of P3–P6; the Mac's `git pull` had been silently aborting on a
      local `package.json` edit for two days.

      Three lessons worth keeping, all of which cost a build each:
      - **`app.json`'s buildNumber is an intent, not a record.** It advances on
        most commits whether or not a build is cut. Check App Store Connect.
      - **Config-plugin mods chain LIFO**, so `plugins/withQleckIos.js` must sit
        FIRST in the plugins array to get the last word. It was in the middle,
        which is why its `UIBackgroundModes` deletion had never once worked.
      - **Local notifications need no push entitlement.** expo-notifications
        adds `aps-environment` anyway, which fails signing against a
        distribution profile with no push capability. Stripped in the plugin
        rather than enabling a capability the app never uses.

      Verify all of that without a Mac: `npx expo config --type introspect`.
- [ ] Resend sending domain (so testers other than the owner can get codes).
      **Rotate RESEND_API_KEY as part of this**, not before: the current key was
      printed in full into a Cloudflare tail log on 2026-09-01 (the BOM made the
      runtime warn about a non-ASCII header value, and the warning includes the
      header). Today that key can only send from `onboarding@resend.dev` to the
      owner's own address, so the blast radius is a burnt quota -- deliberately
      deferred. The moment a domain is verified it can send AS that domain, and
      then it matters. Paste the new key at the `wrangler secret put` prompt
      rather than piping it, or the BOM comes back.
