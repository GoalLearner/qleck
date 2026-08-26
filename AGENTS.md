# Qleck — social plans, streaks & polls app

"Plans that actually happen." Qleck (formerly **Rally** — renamed 2026-08-04 per
the owner's partner; internal identifiers still say Rally) lets you rally your
people around one-off plans (RSVPs, invites, open invites), daily and team
challenges, quick group polls, and cheering each other's achievements. Every
yes lands on everyone's calendar. Built with **React Native + Expo (SDK 56),
TypeScript**. Visual language comes from the Claude Design project
`Rally App.dc.html` (design project ccc3325c-9294-492a-bb94-8aa35ee9d8be);
new in-app screens follow its tokens (`src/theme.ts`). The onboarding/Qoach
surfaces are ported from `Qleck Onboarding.dc.html` (design project
7091d355-0d06-4e43-b873-002e9629705c) and keep their own token *names* in
`src/onboarding/theme.ts`.

**Appearance (owner call 2026-08-25):** one setting drives BOTH token sets —
the coach and the app must never disagree. `src/state/ThemeContext.tsx` holds
the pref (`system` | `light` | `dark`, persisted, chosen in the You tab) and
rewrites the live `colors` and `night` objects in place before render. Light =
Rally cream; dark = Electric Night. Two rules keep it working:
1. **Never capture a palette value in a module-level const** (`const INK =
   colors.ink`) — it freezes to whichever mode loaded first. Read
   `colors.x` / `night.x` inside the component.
2. **Never add `StyleSheet.create` with palette colors** — it snapshots too.
   Every style in this app is inline on purpose.

## Ground rules
- Expo HAS CHANGED. Read the exact versioned docs at
  https://docs.expo.dev/versions/v56.0.0/ before writing any code.
- Dev happens on **Windows**; final signed iOS builds are done from the owner's
  **MacBook** (or via Expo EAS). Keep everything buildable cross-platform
  (iOS + Android + web preview).
- The design's phone-frame chrome (`ios-frame.jsx`) is mockup scaffolding —
  never port it; real devices supply their own status bar / safe areas.

## Navigation — React Navigation (NOT Expo Router)
Configured entirely in code. Do **not** mix in Expo Router.
- Entry: `index.ts` → `registerRootComponent(App)` (NOT `expo-router/entry`).
- There is intentionally **no `app/` directory** (that would signal Expo Router).
- Hierarchy in `App.tsx`: root native stack — `Onboarding` (when logged out) or
  `Tabs` + `Event` + `Challenge` + `Friends` + `Friend` + `Create` (modal).
  `Onboarding` runs its own internal screen switch, not a nested navigator.
  `Tabs` is a bottom-tab navigator (Today / Goals / You) with a custom
  floating pill tab bar (`src/components/RallyTabBar.tsx`) whose center "+"
  opens `NewGoal` — the in-app Qoach intake modal. The app is **purely the
  coach** (owner call 2026-08-24): Rally-era social surfaces (Plans, Streaks,
  Create, Friends, Event/Challenge detail screens) are quarantined out of the
  shell — files kept, routes removed — and return behind real backends per
  ROADMAP P6. Qoach surfaces (intake, chat thread, verdicts, NewGoal modal)
  keep their own token names but follow the shared appearance setting — the
  old "Electric Night lives inside the app" exception is retired (see
  Appearance above). A locked protocol renders via
  `src/components/protocolViews.tsx` on Today/Goals/You.

## Structure
- `App.tsx` — fonts (Young Serif + Plus Jakarta Sans), providers, navigators.
- `src/theme.ts` — colors / category palettes / fonts / radii (single source of
  styling truth, ported 1:1 from the design canvas).
- `src/data/` — `types.ts` shapes + `mockData.ts` (people, events, challenges,
  polls, achievements).
- `src/state/RallyContext.tsx` — app state: RSVP, invites, check-ins, follow
  graph, poll votes, cheers, team-progress logging, create flow. Also owns
  **who you are**: `profile` (`UserProfile`, seeded from `DEFAULT_PROFILE` =
  the demo's "Dana") and `applyOnboarding(result)`, which folds an
  `OnboardingResult` in — blank fields keep the default, so the log-in-only
  path doesn't wipe your name. Read people through `people`, **not** the raw
  `FRIENDS` map: `people` is `FRIENDS` with `'d'` ("you") rewritten from the
  live profile, so your own name and initial are right in every avatar stack
  and leaderboard.
- `src/components/` — Avatar, ProgressRing, EventRow, WeekDots, PollCard,
  AchievementCard, FollowPill, RallyTabBar, SectionLabel, FadeInUp, YouAvatar
  (your own avatar — the gradient you picked in onboarding, or the cream chip
  when you never picked one).
- `src/screens/` — Home, Plans, Challenges (Streaks), Profile (You),
  Friends, FriendProfile, EventDetail, ChallengeDetail, Create (3-step flow:
  plan / challenge [streak or team total] / poll). `LoginScreen.tsx` is the
  older cream-palette login — superseded by `src/onboarding/`, kept for
  reference and no longer wired into `App.tsx`.
- `src/onboarding/` — the whole logged-out funnel, ported from
  `Qleck Onboarding.dc.html`. `theme.ts` (Electric Night tokens), `ui.tsx`
  (shell / buttons / inputs / the canvas' keyframes as Animated wrappers),
  `useOnboardingFlow.ts` (the state machine, 1:1 with the canvas' `DCLogic`),
  `OnboardingFlow.tsx` (screen switch + toast), `screens/` (14 screens).
  Three journeys share one state machine: sign-up (welcome → auth → signup →
  verify → profile → goal → invite → perms → done), log-in (login → Face ID),
  and recovery (forgot → sent → reset). Auth is still mocked exactly as the
  canvas mocked it — code `424242`, password `qleck123`, `sara@qleck.com`
  triggers the duplicate-account sheet — and `demoHints` shows the tap-through
  affordances. Phase 2 replaces those branches; the screens and copy stay.
  Fonts: Space Grotesk 700 + DM Sans 400/500 (loaded in `App.tsx`).

## Phases
**Read docs/ROADMAP.md first** — the master roadmap (APPROVED 2026-08-23, P1-P6:
AI proxy spike → schema freeze + persistence → FriendKey surgery → real auth on the
funnel → living protocol → store gauntlet → friends-lite). It sequences the
AI-coach vision on top of the coarse phases below, which are kept for capability
detail. Qleck's core is an AI goal coach: free-text goal → feasibility verdict
(counter-offer / safety refusal) → step-by-step protocol lived via the existing
streak surfaces. AI calls go through a `qleck-api` CF Worker — never from the client.
1. ✅ Full UI with mock data + local state — plans, invites, open invites,
   streak + team challenges, polls, cheers, follow/friend profiles.
2. Accounts backend: email/SMS magic-link auth + password reset, verified
   profiles with photo (photo is a must), duplicate/impersonation guard,
   GDPR-compliant data handling (no leaked names/contacts), real follow graph,
   open-events region filtering. The **UI for all of this already exists** in
   `src/onboarding/`, and its result already flows into `RallyContext` — name,
   handle and avatar drive the app today; `firstGoal` / `goalPeriod` /
   `allowNotifications` / `allowMotion` are stored on the profile but not yet
   acted on. Phase 2 is swapping the mock auth branches for real calls and
   persisting the profile across launches.
3. Device integrations: HealthKit / Health Connect step import (manual entry
   stays as the fallback), real calendar sync (expo-calendar), push nudges.
- **Parked** (owner's partner's ideas, deliberately not built yet): listings /
  marketplace with contact-sharing middleman, and monetization (ads,
  ad-free tier, paid listings) — revisit after real usage data, per the same
  doc's "monitor how users use the app first" note.

## Preview
`rally-web` config in `.claude/launch.json` runs `expo start --web` on port
8090 for browser preview. On device, use Expo Go. Shareable single-file web
build: `npx expo export --platform web` then the `build-artifact.mjs` script
(inlines bundle + fonts) → published as a claude.ai artifact.
