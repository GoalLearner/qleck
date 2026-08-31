# `src/demo/` — the Rally-era world (mock only)

Everything in this folder is **make-believe**: invented people, invented
plans, polls, challenges and a follow graph, all keyed by the toy identity
`FriendKey` — single letters, with `'d'` meaning "you".

It lives here, behind its own module boundary, because of **ROADMAP P2b**:
*kill the toy identity model before anything fossilizes.*

## The one rule

```
demo may read the real app;  the real app may never read demo.
```

`DemoContext` imports `useRally()` to get your real name and initial. Nothing
in `src/state/`, `src/screens/`, `src/lib/`, `src/api/` or `src/onboarding/`
imports anything from this folder — enforced by `npm run check:demo`.

That one-way arrow is what retires the dual-model durability leak. A mock
person cannot reach real data, and your real identity is never expressed as a
`FriendKey`. The real identity is `currentUserId` on `RallyContext` (the
server's user UUID); the real profile is `UserProfile` in `src/data/types.ts`.

## Why the keys are still letters, not UUIDs

Deliberate. A letter is *obviously* fake at a glance; a UUID would make mock
data look like real data, which is the exact confusion this phase exists to
prevent. The toy model is not being migrated — at **P6** these surfaces
return on real backends and `types.ts` here is **replaced** by server-shaped
types keyed on user UUIDs.

## Current state: unmounted

Nothing here renders today. The Rally-era routes were removed from the shell
when the app became purely the coach (owner call 2026-08-24), and
`DEMO_ENABLED` is `false`. Reviving it takes three deliberate steps — see
`flag.ts`.

## Contents

| Path | What |
|---|---|
| `flag.ts` | `DEMO_ENABLED` — the single switch |
| `types.ts` | `FriendKey` and the social shapes |
| `mockData.ts` | The invented people, events, challenges, polls, achievements |
| `DemoContext.tsx` | The in-memory state machine + `useDemo()` |
| `components/` | Avatar, EventRow, PollCard, AchievementCard, FollowPill, WeekDots |
| `screens/` | Plans, Challenges, Create, Friends, FriendProfile, EventDetail, ChallengeDetail |

`src/components/WeekDots.tsx` moved here; the live Today tab has its own
week strip built on the real temporal layer (`src/lib/protocolTime.ts`).
