# Qleck — social plans, streaks & polls app

"Plans that actually happen." Qleck (formerly **Rally** — renamed 2026-08-04 per
the owner's partner; internal identifiers still say Rally) lets you rally your
people around one-off plans (RSVPs, invites, open invites), daily and team
challenges, quick group polls, and cheering each other's achievements. Every
yes lands on everyone's calendar. Built with **React Native + Expo (SDK 56),
TypeScript**. Visual language comes from the Claude Design project
`Rally App.dc.html` (design project ccc3325c-9294-492a-bb94-8aa35ee9d8be);
new screens follow its tokens (`src/theme.ts`).

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
- Hierarchy in `App.tsx`: root native stack — `Login` (when logged out) or
  `Tabs` + `Event` + `Challenge` + `Friends` + `Friend` + `Create` (modal).
  `Tabs` is a bottom-tab navigator (Home / Plans / Streaks / You) with a custom
  floating pill tab bar (`src/components/RallyTabBar.tsx`) whose center "+"
  opens `Create`.

## Structure
- `App.tsx` — fonts (Young Serif + Plus Jakarta Sans), providers, navigators.
- `src/theme.ts` — colors / category palettes / fonts / radii (single source of
  styling truth, ported 1:1 from the design canvas).
- `src/data/` — `types.ts` shapes + `mockData.ts` (people, events, challenges,
  polls, achievements).
- `src/state/RallyContext.tsx` — app state: RSVP, invites, check-ins, follow
  graph, poll votes, cheers, team-progress logging, create flow.
- `src/components/` — Avatar, ProgressRing, EventRow, WeekDots, PollCard,
  AchievementCard, FollowPill, RallyTabBar, SectionLabel, FadeInUp.
- `src/screens/` — Login, Home, Plans, Challenges (Streaks), Profile (You),
  Friends, FriendProfile, EventDetail, ChallengeDetail, Create (3-step flow:
  plan / challenge [streak or team total] / poll).

## Phases
1. ✅ Full UI with mock data + local state — plans, invites, open invites,
   streak + team challenges, polls, cheers, follow/friend profiles.
2. Accounts backend: email/SMS magic-link auth + password reset, verified
   profiles with photo (photo is a must), duplicate/impersonation guard,
   GDPR-compliant data handling (no leaked names/contacts), real follow graph,
   open-events region filtering.
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
