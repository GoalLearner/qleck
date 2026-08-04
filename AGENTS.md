# Insight — Instagram analytics app (personal recreation)

A from-scratch recreation of an Instagram follower-analytics app (à la "Followers
Tracker / Reports+") for the owner's personal use. Built with **React Native + Expo
(SDK 56), TypeScript**.

## Ground rules
- Expo HAS CHANGED. Read the exact versioned docs at
  https://docs.expo.dev/versions/v56.0.0/ before writing any code.
- **Only legitimate data.** We use Instagram's official Graph API (Business/Creator
  account) — never private/scraped endpoints or password login (ToS violation +
  ban risk). Metrics Instagram does not expose (ghost followers, "blocked you",
  admirers, profile stalkers) are intentionally omitted, per the owner's choice to
  *hide* them rather than fake them.
- Dev happens on **Windows**; final signed iOS builds are done from the owner's
  **MacBook** (or via Expo EAS). Keep everything buildable cross-platform.

## Navigation — React Navigation (NOT Expo Router)
This project uses **React Navigation**, configured entirely in code. Do **not**
mix in Expo Router.
- Entry: `index.ts` → `registerRootComponent(App)` (NOT `expo-router/entry`).
- There is intentionally **no `app/` directory** (that would signal Expo Router).
- Hierarchy: a `createNativeStackNavigator` root (`Tabs` screen + `Paywall` modal)
  wraps a `createBottomTabNavigator` (5 tabs). All defined in `App.tsx`.
- New screens are added as `Tab.Screen`/`RootStack.Screen` in `App.tsx`, not as files
  in an `app/` router tree.

## Structure
- `App.tsx` — root stack (Tabs + Paywall modal) and the bottom tab navigator.
- `src/theme.ts` — colors / spacing / fonts (single source of styling truth).
- `src/data/` — `types.ts` shapes + `mockData.ts` (Phase-1 placeholder data).
- `src/components/` — ScreenBackground, AppHeader, ProfileSummary, MetricCard, Placeholder.
- `src/screens/` — Analytics (main dashboard), Stories, FriendsStories, Repost,
  Settings, Paywall.

## Phases
1. ✅ UI shell + dashboard with mock data (done).
2. Instagram Graph API: OAuth login + real metrics (followers, profile views, reach,
   impressions, per-post insights, demographics). Needs a Meta developer app.
3. Polish: trend charts, pull-to-refresh, multi-account switching.

## Preview
`insight-web` config in `.claude/launch.json` runs `expo start --web` on port 8090
for browser preview. On device, use Expo Go.
