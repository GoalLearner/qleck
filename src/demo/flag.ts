// The single demo switch (ROADMAP P2b, owner sign-off 2 of 2026-08-23).
//
// OFF means: no mock person, plan, poll, challenge or follow graph exists
// anywhere the user can reach. Note the quarantine is belt AND braces — the
// Rally-era routes are also gone from the shell (owner call 2026-08-24), so
// flipping this alone does not reveal them. Reviving the demo world takes
// three deliberate steps, which is the point:
//
//   1. DEMO_ENABLED = true
//   2. mount <DemoProvider> inside <RallyProvider> in App.tsx
//   3. re-add the routes for src/demo/screens/*
//
// At P6 these surfaces come back on real backends — server-shaped types keyed
// on user UUIDs REPLACE src/demo/types.ts. Nothing here is migrated.
export const DEMO_ENABLED = false;
