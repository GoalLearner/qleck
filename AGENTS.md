# Rally — social plans & streaks app

"Plans that actually happen." Rally lets you rally your people around one-off
plans (hangouts with RSVPs) and daily challenges (streaks with leaderboards).
Every yes lands on everyone's calendar. Built with **React Native + Expo
(SDK 56), TypeScript**. Implemented from the Claude Design project
`Rally App.dc.html` (design project ccc3325c-9294-492a-bb94-8aa35ee9d8be) —
that canvas is the source of truth for visuals and copy.

> History: this repo previously held the "Insight" IG-analytics shell; it was
> checkpoint-committed and replaced by Rally (see git log).

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
  `Tabs` + `Event` + `Challenge` + `Create` (modal). `Tabs` is a bottom-tab
  navigator (Home / Plans / Streaks / You) with a custom floating pill tab bar
  (`src/components/RallyTabBar.tsx`) whose center "+" opens `Create`.

## Structure
- `App.tsx` — fonts (Young Serif + Plus Jakarta Sans), providers, navigators.
- `src/theme.ts` — colors / category palettes / fonts / radii (single source of
  styling truth, ported 1:1 from the design canvas).
- `src/data/` — `types.ts` shapes + `mockData.ts` (friends, events, challenges).
- `src/state/RallyContext.tsx` — app state: RSVP, invites, check-ins, create
  flow (port of the design's DCLogic).
- `src/components/` — Avatar, ProgressRing, EventRow, WeekDots, RallyTabBar,
  SectionLabel, FadeInUp.
- `src/screens/` — Login, Home, Plans, Challenges (Streaks), Profile (You),
  EventDetail, ChallengeDetail, Create (3-step flow).

## Phases
1. ✅ Full UI from the design canvas with mock data + local state (done).
2. Real accounts + backend (auth, friends, invites, push nudges).
3. Real calendar sync (expo-calendar), photos on events, notifications.

## Preview
`rally-web` config in `.claude/launch.json` runs `expo start --web` on port
8090 for browser preview. On device, use Expo Go.
