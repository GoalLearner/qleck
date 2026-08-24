# Qleck — Master Roadmap

> **Status: APPROVED** (2026-08-23) — all three sign-offs granted by the owner same day.
> Produced via a 14-agent
> planning workflow: codebase audit + capability map, four competing roadmap lenses
> (AI-core-first / Foundation-first / Retention-first / Lean-de-risk), a 3-judge panel
> (unanimous winner: the Lean-de-risk spine), synthesis, then three adversarial critiques
> (22 findings folded in).
>
> Owner sign-offs — **all approved 2026-08-23**:
> 1. Photo-required profile **deferred past beta** (a deviation from AGENTS.md Phase 2; R2 seam preserved).
> 2. **Plans / Polls / Friends hidden** behind the demo flag in non-demo beta builds until Phase 6.
> 3. **Email-only auth** for beta (phone path hidden, social buttons removed until SIWA+Google ship together).

## 1. North star

Functional means a stranger can install Qleck from TestFlight, sign up with a real email, type any goal in their own words, get an AI feasibility verdict (with counter-offer or safe refusal), accept a generated step-by-step protocol, and live it day by day — check-ins, streaks, nudges — with data that survives restarts, reinstalls, and a second device. Strong foundation means the D1 schema, auth model, and AI pipeline are set from evidence and **additive-only after Phase 2**, so Phase 2/3 AGENTS.md features (photo, health import, calendar, groups) attach through pre-reserved seams instead of destructive migrations. The sequencing rule: every phase retires exactly one product-killing risk and ends in something the owner can feel on his phone.

## 2. Architecture decisions

**Backend: Cloudflare Workers + D1 + R2, one new `qleck-api` Worker project.**
Owner already runs a production app on this paid stack (D1, DOs, auth, push); it is proven, cheap, and requires zero new platform learning. Tables and endpoints named `qleck_*` from the first migration — the Rally naming drift stays client-side only. R2 arrives with photos (deferred); Durable Objects only if realtime group features ever demand them.

**Data model: Goal is the atom.** `users(UUID)` → `goals` (free-text + accepted-statement version, status, timezone, `visibility` column `private|cheerable|group` from day one) → `protocols` (versioned JSON + version history) → `protocol_steps` / dated `scheduled_reps` (typed binary | quantity+unit | duration) → `check_ins`. Two hard invariants, declared in the schema doc before anything freezes:

1. **Check-ins are anchored to `(goal_id, user_id, local_date, rep descriptor, client UUID)` — never FK-cascaded from `protocol_steps`.** Delete-cascades hang only off `users` (and per-goal delete off `goals`). A protocol revision can therefore never eat check-in history.
2. **Past `scheduled_reps` and `check_ins` are immutable; revisions regenerate only future reps; steps carry stable IDs across protocol versions** ("we kept your Tuesday run, shortened it"). Revision-shaped fixtures run in the Phase-1 harness so adaptation semantics inform schema v1 *before* the freeze, not two phases after.

A **`goal_members` join table** (goal_id, user_id, role, joined_at) is reserved in the product migration alongside `visibility` — since check_ins already carry user_id, team totals and streak leaderboards later become aggregation queries, not schema surgery. The shipped Challenge/WeekDots surfaces become derived views over this hierarchy; their *social* faces (leaderboards, contributions, with-friends create) go behind the demo flag until Phase 6 gives them a real backend. GDPR is a schema property: delete-cascade FKs, export shape, and a split `ai_requests` design — a metadata row (model, tokens, cost, verdict class; retained long-term, no user text) and a payload blob (prompt/response text; 30-day retention; harness runs marked synthetic and exempt).

**Migrations, honestly numbered:** `0001` ships in **Phase 1** — `ai_requests` + `coach_sessions` only, ops tables outside the freeze. `0002` ships in Phase 2a — the product schema, free to reshape 0001's tables.

**IDs + sync:** Client-minted UUIDs; server-authoritative D1 with an AsyncStorage cache. The queued-mutation outbox is **scoped to check-ins only** — the one append-mostly, genuinely-offline flow; goals/protocols are created online with the AI in the loop anyway (optimistic UI + simple retry). Three sync invariants: every mutation carries its client UUID as a server-side idempotency key (INSERT OR IGNORE — no double-counted kilometers on retry); check_ins carry a client-asserted `local_date` that is authoritative for streak math; streaks/milestones are always **derived at read time, never stored** — Phase-6 feed events render from derived state. Deliberately **not** CRDT/offline-first; hold that line ruthlessly.

**Per-goal privacy:** enforced in every API query — the server never serializes a private goal's existence to non-owners. Private by default; `cheerable` opens in Phase 6; `group` is a reserved seam. Flipping private→shared re-runs the safety classifier before anything reaches a feed.

**AI pipeline (live from day one, never mocked, never naked):** *(Amended 2026-08-23, owner call: the provider is pluggable — DeepSeek (`AI_PROVIDER=deepseek`, default) carries the beta for cost, ~$0.005/goal; the Claude path stays wired and warm behind the same `callModel()` surface for when coach quality matters. Server-side schema validation + retry is the correctness backstop either way.)* all Claude calls go through the Worker — key in Worker secrets only, prompt templates versioned server-side. The intake/negotiation flow is a *conversation*, so its state lives server-side: a `coach_sessions` table holds the transcript and turn count; the client sends only `session_id` + the new message, and the 2–3-turn cap and safety verdict are enforced per session on the server — a tampered client cannot replay an edited transcript or loop past the cap. Flow: free-text intake (+2–3 clarifying questions) → cheap-model safety pre-classifier (refusal templates with crisis/professional resources; goal text is data, never instructions) → feasibility verdict as tool-use JSON `{feasible | counter-offer | declined}` → protocol generation (top-tier model, server-side schema validation, regenerate-on-invalid; AI output enters the app only by round-tripping the versioned schema) → adaptation, **user-triggered** in v1, future-reps-only per the immutability invariant. Cost rails congenital to the proxy: model tiering, prompt caching, per-device/user quotas, token+cost logging, kill-switch env flag.

**Auth:** email magic-link/OTP via **Resend** (MailChannels' free Workers path is dead) + password/reset, wired into the existing funnel by swapping the mock branches in `useOnboardingFlow.ts` — the `nav()` state machine and copy are preserved, but real auth adds per-action loading/error/expired-code states across ~6 actions, and two deliberate funnel edits: the **phone-number path is hidden** (email-only beta; branches kept recoverable behind the demo flag until SMS is un-deferred) and the **socialJoin button is removed** (that's what keeps deferred SIWA clear of Apple 4.8). JWT access + refresh with revocation (owner's battle-tested invariants), SecureStore on native with an explicit web token strategy defined in P3. ToS + privacy-policy acceptance is a P3 signup deliverable, not a P5 retrofit. Sending domain gets SPF/DKIM/DMARC with an inbox-not-spam test before the funnel swap is called done.

**Identity claiming is row promotion, not migration:** the anonymous device row **IS** the user row — sign-up attaches an email identity to the existing `users.id` (one UPDATE + an `identities` INSERT; FKs untouched; no merge engine). The one conflict case is decided now: signing in on a device whose anon account has data, into an account that already exists → server wins; the anon rows are orphaned-and-logged after a confirm prompt, never merged. Claim is one-way and once. Anon accounts idle >90 days are garbage-collected (closes the GDPR orphan of free-text health goals nobody can delete). Android's keychain does not survive reinstall; pre-auth data loss there is accepted and documented.

**Decided conflicts:**
- *FriendKey surgery timing:* its own phase (2b), immediately after persistence, incremental compiling steps gated by a written regression checklist — not quarantined until Phase 6, not a Phase-1 big-bang, and **not welded to the sync-engine build** (both rewrites run through `RallyContext.tsx`; doing them simultaneously in a test-free codebase is the plan's likeliest multi-week stall).
- *Mock social surfaces:* beta tab layout is **Today / Goals / You**. Plans, Polls, and Friends are feature-flagged OFF in non-demo builds from the first signed build, flipping back per-surface as Phase 6 delivers each a real backend. A fresh real account never sees fake friends or dead polls.
- *Adaptation cadence:* on-demand in v1; cron only after demand shows.
- *Push:* locally scheduled `expo-notifications` first; server push arrives with cheers. The onboarding primer stays a soft pre-prompt; the one-shot iOS OS permission request fires at **first protocol acceptance**, never inside the signup funnel.
- *Photo-required:* deferred past beta **as an explicit AGENTS.md deviation the owner must sign off**; profile row + R2 seam preserved.

## 3. The phases

### Phase 1 — Real coach, zero accounts (AI proxy spike) — **M**
**Objective:** prove the brain end-to-end — safety gate, verdict with counter-offer, schema-valid protocol — while product state is still ephemeral and cheap to change.

- [ ] `qleck-api` Worker (dev + prod, CORS for :8090) with `/coach` endpoints; Anthropic key in Worker secrets only; **migration 0001: `ai_requests` (metadata/payload split) + `coach_sessions` — ops tables, explicitly outside the product freeze**
- [ ] Server-held coach sessions: transcript + turn count in D1, negotiation capped 2–3 turns server-side
- [ ] Safety pre-classifier (cheap tier) + refusal templates with crisis/professional-help copy; injection hygiene (goal text = data)
- [ ] Feasibility verdict as validated tool-use JSON, one retry on invalid
- [ ] `protocol_schema` v1, versioned: phases, typed reps, milestones, **stable step IDs** — shaped for the existing WeekDots/streak UI
- [ ] Cost rails from call #1: tiering, prompt caching, per-device+IP quota with clean 429, kill-switch, token/cost logging
- [ ] Client: FirstGoalScreen picker → free-text intake reusing the Qoach advice-card; ProtocolPreview screen; the app's first loading/error/retry states
- [ ] Hand-author 3–4 protocol templates against schema v1 — human-fillability test + permanent eval fixtures
- [ ] Automated eval harness — ~20 canned goals (realistic/unrealistic/unsafe/injection) **+ 2–3 "revise this in-flight protocol" fixtures** so revision output shapes inform the schema before Phase 2a freezes it — replayed against live endpoints, scored from `ai_requests`
- [ ] Draft not-medical-advice disclaimers, health-claim framing rules, and Apple age-rating/AI-questionnaire answers in the same pass as the refusal copy
- [ ] Web preview stays private until real auth lands

**Exit:** "run a 4k in 6 weeks" → verdict + rendered multi-week protocol on web AND Expo Go in ~20s; "lose 15kg in 2 weeks" → counter-offer; unsafe goal → supportive refusal with resources; injection goal analyzed as data; revision fixtures produce future-only, stable-ID revisions; harness ≥95% schema-valid within 2 attempts and 100% unsafe refusal (fixed bar — no prompt-polish past it); grep of repo + exported bundle finds no key; per-goal cost in the cents band.
**Retires:** the product-killing unknown — that the coach can't produce a credible, safe, affordable verdict + protocol.

### Phase 2a — Schema freeze + persistence (goal vertical) — **M**
**Objective:** freeze the product schema from Phase-1 evidence (additive-only afterward); make coach data survive restarts and offline — without touching the identity model yet.

- [ ] Migration 0002: `users`, `identities` (reserved), `goals` (+visibility), **`goal_members` (reserved)**, `protocols`, `protocol_steps`, `scheduled_reps`, `check_ins` (goal_id + user_id + local_date + client UUID anchoring) — delete-cascade FKs off `users`/`goals` only, export shape designed in
- [ ] Anonymous device accounts (signed device token) so persistence + quotas work pre-auth; 90-day anon GC; one-way-once claim policy documented
- [ ] AsyncStorage cache + outbox **for check-ins only** (everything else online-required, optimistic UI + retry); idempotency keys enforced server-side; client-asserted `local_date` authoritative
- [ ] Real temporal layer: timezone-correct "today," check-ins on actual dates, streak math with miss-detection **derived at read time** (retires the `week[6]` hack)

**Exit:** create goal → force-quit → relaunch: intact on device and web; airplane-mode check-in syncs on reconnect; **kill the app mid-sync, relaunch, no duplicate rows**; missed day breaks the streak correctly on seeded dates.
**Retires:** freezing the wrong foundation — display-dates and ad-hoc state can now never reach the server.

### Phase 2b — FriendKey surgery + demo-flag quarantine — **M**
**Objective:** kill the toy identity model before anything fossilizes, as its own shippable phase so a stall here never holds auth hostage.

- [ ] Full FriendKey→UUID surgery: kill the letter union, `DAYMAP`, the `'d'` sentinel across all types/screens in small compiling steps; `currentUserId` in context
- [ ] RallyContext split: server-data layer vs UI state, preserving `applyOnboarding` merge semantics
- [ ] Demo choreography (DUMPLING/JOG, inviteState) **and the structurally-social challenge surfaces** — leaderboards, team contributions, with-friends create — extracted behind one demo flag; single-player check-in UI stays live
- [ ] Written manual regression checklist (RSVP, invites, polls, cheers, follow, team logging *scoped demo-flag-only*, 3-step Create) run on web + Expo Go — the standing net for every later phase

**Exit:** grep = zero FriendKey/DAYMAP/`'d'`; checklist passes clean; demo flag off shows no mock people anywhere in the goal vertical.
**Retires:** the dual-model durability leak.

### Phase 3 — Real auth on the existing funnel + first builds — **L**
**Objective:** accounts on the proven stack; surface the signing dependency and the iteration toolchain early. Depends only on 2a.

- [ ] Email magic-link/OTP via Resend + password/reset + username availability + duplicate-guard; `nav()` and copy preserved, async in-flight/error states added per action; **phone path hidden, socialJoin removed** (both recoverable behind the demo flag)
- [ ] Sending domain: SPF/DKIM/DMARC configured; OTP lands in the **inbox** (not spam) on Gmail, iCloud, and Outlook before the swap is called done; password login as documented fallback during mail incidents
- [ ] ToS + privacy-policy acceptance in the signup funnel
- [ ] JWT access + refresh with revocation; SecureStore on native, web token strategy defined; session store replaces `loggedIn` useState; mid-funnel resume
- [ ] Identity claim as **row promotion** (UPDATE + identities INSERT); second-device conflict = server-wins, anon discarded after confirm, logged
- [ ] `424242`/`qleck123`/`TAKEN_USERNAMES` deleted (review-demo path feature-flagged only); AI quotas switch device→user; **no OS notification prompt anywhere in the funnel**
- [ ] **Crash/error reporting with the first signed build:** `client_errors` endpoint on `qleck-api` logging to D1 (owner's proven pattern) or sentry-expo
- [ ] EAS profiles; **expo-dev-client builds** — locally-built Android dev client on the Windows machine as the daily iteration driver + occasional EAS iOS dev build — plus first internal TestFlight + Play internal track (TestFlight is for soaks and review, never iteration)

**Exit:** real signup with real email on a fresh install; same goal + streak on a second device/web; refresh rotation survives a forced 401; revocation lands next launch; a deliberate client error shows up in D1; owner + a friend on the signed build.
**Retires:** that real auth is a swamp; that signing or a missing debug channel blocks the path later.

### Phase 4 — Living protocol: execution, lifecycle, nudges, adaptation — **L**
**Objective:** turn the stored protocol into lived days — a coach, not a PDF viewer. Requires 2b.

- [ ] Execution engine: protocol → concrete dated reps; binary/quantity/duration check-in flows on the WeekDots/ProgressRing surfaces; milestone events recorded — built against the Phase-1 fixtures before pointing at live AI output
- [ ] **Goal lifecycle state machine:** active/paused/completed/abandoned with a completion moment; per-goal delete cascading protocol/reps/check-ins via the existing FKs; nudges cease on any non-active state
- [ ] Home re-centered on "today's reps"; **beta tab layout goes live: Today / Goals / You** — Plans/Polls/Friends flagged off for non-demo accounts, real empty states where a surface stays; clean-account first-run added to the regression checklist
- [ ] Goal intake reachable from `+` (multiple concurrent goals); one-line disclosure at intake ("your goal is sent to our AI provider to build your plan")
- [ ] Local `expo-notifications`: morning rep nudge + evening streak-at-risk nudge, deep link → today's check-in ≤2 taps; quiet hours + per-goal mute; **OS permission requested at first protocol acceptance**, Settings deep-link fallback for prior denials
- [ ] On-demand adaptation: "Adjust my plan" → consented, versioned, **future-reps-only** revision with browsable history; scale-down-first tone; capped 1/goal/day

**Exit:** owner lives one real goal 7 consecutive days on TestFlight — nudges fire at correct local times, a missed day breaks the streak, Adjust yields a visibly easier week, declining changes nothing; a completed goal celebrates and goes quiet; two goals run without cross-talk; a fresh non-demo account sees zero mock content; checklist passes. **The 7-day soak starts at code-complete and runs concurrently with Phase 5 build work — it gates store submission, not Phase 5 start.**
**Retires:** that a generated protocol is a one-shot artifact nobody lives with.

### Phase 5 — Store gauntlet — **M**
**Objective:** clear Beta App Review with the minimum compliant surface, using copy drafted in Phase 1.

- [ ] In-app account deletion: hard-delete cascade across D1, device/push tokens, AI logs; JSON export endpoint; 30-day retention enforced **on `ai_requests` payloads only** (metadata + synthetic harness rows retained); privacy policy naming Anthropic as subprocessor
- [ ] 13+ age gate; stricter classifier thresholds for age-sensitive weight/appearance goals
- [ ] Not-medical-advice disclaimers on verdict/protocol UI; hedged-language audit; "talk to your doctor" framing
- [ ] "Report this AI response" control (Play AI-GC policy) logging to D1
- [ ] Review pack: demo account with live AI, App Privacy labels, Phase-1 age-rating answers, mock-code audit, **clean-account walkthrough in the reviewer script** — the goal-vertical-only tab layout is also the fastest path to protocol in <2 minutes
- [ ] External TestFlight via Beta App Review + Play closed track (one resubmission budgeted; fallback = narrow beta copy to fitness/skill goals)

**Exit:** Beta App Review approved, external invite link live; deleting a test account verifiably purges D1/tokens/logs; reviewer reaches goal→verdict→protocol in <2 minutes with zero placeholder content on screen.
**Retires:** that Apple/Google won't let an AI coaching app through — retired where rejection costs a cycle, not a launch.

### Phase 6 — Friends-lite + 5–10 real users — **M**
**Objective:** minimum per-goal social and the only readout that matters: strangers living with it.

- [ ] Real follow/friend edges in D1; per-goal visibility switch (private default, cheerable opt-in); server-side enforcement — private goals absent from every non-owner response
- [ ] Re-moderation hook: private→cheerable re-runs the safety classifier
- [ ] Milestone/streak events → privacy-filtered feed **rendered from derived state** (late syncs can't falsify frozen events); cheer → Expo push to goal owner (first server-push surface); Friends surface flag flips back on
- [ ] UGC minimum (Apple 1.2): report content, block user, contact mechanism — shipped with the feed
- [ ] Invite link/code flow
- [ ] Sync-recency active-user metric (never app-opens) instrumented **before** testers arrive; readout: activation, D7 check-in retention (**active goals only**), counter-offer acceptance, adaptation usage, AI cost/user, **crash-free rate / unexplained client_errors**

**Exit:** 5–10 external users, each ≥1 real goal + ≥1 week of check-ins; private goal invisible via direct API probing (tested, not assumed); cheer round-trips to a push; written go/no-go readout exists.
**Retires:** the thesis risk itself — plus API-level privacy enforcement.

## 4. Dependency graph

```mermaid
flowchart TD
    P1["P1 — AI proxy spike\n(verdict + protocol + revision fixtures)"]
    P2a["P2a — Schema freeze + persistence\n(goal vertical, check-in outbox)"]
    P2b["P2b — FriendKey surgery\n+ demo-flag quarantine"]
    P3["P3 — Real auth + dev-client\n+ first signed build + crash reporting"]
    P4["P4 — Execution engine + lifecycle\n+ nudges + adaptation + beta tabs"]
    P5["P5 — Store gauntlet"]
    P6["P6 — Friends-lite + real users"]

    P1 -->|"schema frozen FROM proven AI output"| P2a
    P2a -->|"anon rows promoted to accounts"| P3
    P2a --> P2b
    P3 -->|"signed build = daily-driver loop"| P4
    P2b -->|"clean identity model under the engine"| P4
    P4 -->|"lived protocol = reviewable product"| P5
    P5 -->|"external invite link"| P6
    P2b -->|"no letters ever reach the server"| P6

    P1 -.->|"fixtures test P4 engine"| P4
    P1 -.->|"safety/disclaimer copy pre-drafts P5 pack"| P5
    P2a -.->|"FKs guarantee P5 deletion"| P5
    P2a -.->|"goal_members + visibility = P6 seams"| P6
    P3 -.->|"user auth closes P1 open-proxy window"| P1
    P4 -.->|"milestone events feed P6 cheers"| P6
```

## 5. Risk register

| # | Risk | Mitigation | Phase |
|---|------|------------|-------|
| 1 | AI can't produce credible/schema-valid protocols (product-killer) | Live spike first; harness with fixed bar (≥95% valid within 2 attempts); hand-authored fixtures as baseline | P1 |
| 2 | Unsafe goals reach users; negotiation jailbreaks the gate | Server-held sessions enforce the turn cap + verdict; pre-classifier + refusal-with-resources; harness includes unsafe/injection/post-push-back cases; re-moderation on privacy flip | P1, P6 |
| 3 | Open anonymous proxy farmed for tokens pre-auth | Kill-switch, per-device+IP quotas, server-side turn caps, web preview private until auth | P1→P3 |
| 4 | Schema frozen wrong → destructive migrations under live data | Freeze from P1 evidence **including revision fixtures**; check-ins decoupled from protocol versions; additive-only after P2a; goal_members/identities/visibility seams reserved | P1–P2a |
| 5 | FriendKey surgery breaks the test-free codebase | Own phase (2b), incremental compiling steps, regression checklist gates close — and auth (P3) doesn't wait on it | P2b |
| 6 | MacBook/EAS signing or slow iteration stalls the path | Signed build + dev-client toolchain pulled to P3, two phases before submission; TestFlight never the iteration loop | P3 |
| 7 | App Review rejects AI coaching / placeholder content (2.1, 5.1.1) | Disclaimer + age-rating copy drafted P1; mock surfaces flagged off P4 (clean fresh-account experience); beta-track review; fallback: narrow beta copy | P1, P4, P5 |
| 8 | Recurring AI cost scales with retained actives | User-triggered adaptation, 1/goal/day cap; tiering/caching/quotas server-side so tightening needs no client release; cost/user in the P6 readout | P1, P4, P6 |
| 9 | Prompt-polish has no finish line (solo-dev trap) | Fixed harness pass bar is the exit decision — "credible," not "perfect" | P1 |
| 10 | Identity claiming becomes a merge engine (the W846 class of bug) | Row promotion, not migration; one-way-once claim; server-wins conflict policy written into P3 exit criteria | P2a–P3 |
| 11 | Sync duplicates or misdates check-ins; late syncs falsify streaks | Idempotency UUIDs, client-asserted local_date authority, read-time-derived streaks; kill-mid-sync test in P2a exit | P2a |
| 12 | Photo-required deferral contradicts AGENTS.md; privacy leak unfixable by UI | Owner signs off the deviation (profile row + R2 seam preserved); privacy enforced in queries and verified by direct API probing before testers arrive | P5–P6 |

## 6. Deliberately NOT in this roadmap

**Parked permanently until real usage data (owner mandate):** listings/marketplace with contact-sharing middleman; all monetization (ads, ad-free tier, paid listings).

**Deferred past "functional," each with a named seam already in place:**
- **Plans / Polls / RSVP / open invites** — hidden behind the demo flag from the first signed build; no persistence built for them in any phase. Seams recorded: plans → session-type `scheduled_reps` + future group/calendar work; polls → post-P6-readout. If the owner wants Plans visible in beta, that is a new persistence deliverable to be sized into a phase — not a silent assumption.
- **Group goals** — `goal_members` table and `visibility='group'` reserved; membership UX waits for the P6 readout
- **Photo upload + impersonation guard** — profile row + R2 seam reserved; explicit owner sign-off on the AGENTS.md deviation
- **HealthKit / Health Connect import** — manual entry is the permanent first-class path; typed reps are the binding point
- **Calendar sync (expo-calendar)** — session-type reps are the seam
- **SMS auth** — phone path hidden behind the demo flag, recoverable; cost + fraud surface says not yet
- **SIWA / Google login** — ship together or not at all (Apple 4.8 — which is why the socialJoin button is removed, not just unwired); `identities` table already multi-provider-shaped
- **Server push beyond cheers** — local notifications carry the retention spine until real users justify cron infrastructure
- **Proactive weekly adaptation cron** — on-demand "Adjust my plan" first; cadence data decides
- **CRDT/offline-first engine** — the check-in-only outbox is the line; anything conflict-prone waits for server round-trips
- **Durable Objects realtime** — only if group features demand it later