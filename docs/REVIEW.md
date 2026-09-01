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
  — `AI_PROVIDER` in `backend/wrangler.toml`. The privacy policy must name
  whichever is actually live at submission.)*
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

- [ ] `wrangler secret put REVIEW_DEMO_PASSWORD`
- [ ] Privacy policy + terms hosted at a public URL, naming the
      subprocessors in §5, linked from App Store Connect
- [ ] Screenshots for both stores
- [x] First TestFlight upload — **build 14, Xcode from the MacBook** (not EAS;
      there is no eas.json and the owner signs locally). Play internal still owed.
- [ ] **Ship a new build.** TestFlight is on build 14 = commit `aeded3f`, which
      is 16 commits back and predates P3 entirely. The `buildNumber` in app.json
      advanced on most commits regardless of whether a build was ever cut, so
      the repo said 16 while TestFlight said 14 — **app.json's number is an
      intent, not a record of what shipped.** Check App Store Connect, not git.

      Build 14 still WORKS against today's backend: it is an anonymous-device
      client (P2a) and that path is unchanged. What it does not have:
      - **Real accounts.** Auth is still the canvas mock — code `424242`,
        password `qleck123`. Nobody can make an account, so every goal lives
        under a device identity: lose the device, lose everything, and there is
        no signing in on a second one.
      - **The P5 store-compliance surfaces** — account deletion, data export,
        the age gate. App Review expects these, so build 14 is not submittable
        regardless of the feature gap.
      - Nudges and never-miss-twice (P4); live milestones, pause and per-goal
        delete (P4 polish); the witness link (P4.5); and the 2026-09-01 audit
        fixes.

      NOT a reason to rush, contrary to an earlier note here: the `authedFetch`
      stale-token wipe cannot happen on build 14. That bug needs a refresh
      token, and build 14's client has no refresh path at all (`git show
      aeded3f:src/api/device.ts` mentions neither `refreshToken` nor
      `tryRefresh`). It arrived with P3, one build later.
- [ ] Resend sending domain (so testers other than the owner can get codes)
