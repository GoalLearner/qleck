import type { Protocol } from '../api/coachTypes';

// The REAL app's shared types. The Rally-era social model (FriendKey, events,
// challenges, polls, achievements) lived here until P2b moved it wholesale to
// `src/demo/` — see that folder's README. Nothing in this file may depend on
// the demo world, so a mock person can never leak into real data again.

// Who you are in the app. Seeded with the demo defaults, then overwritten by
// whatever the onboarding funnel collected (see `applyOnboarding`).
export interface UserProfile {
  firstName: string;
  fullName: string;
  handle: string; // without the leading '@'
  initials: string;
  // The avatar the user picked during onboarding, as a 2-stop gradient.
  // null = the app's default cream chip. Stands in for the real photo until
  // Phase 2 ships uploads.
  avatarColors: [string, string] | null;
  firstGoal: string | null;
  goalPeriod: string | null;
  // The accepted Qoach protocol from onboarding. P1: in-memory only (lost on
  // refresh, by design); P2a persists it; P4's execution engine consumes it.
  protocol: Protocol | null;
  allowNotifications: boolean;
  allowMotion: boolean;
}
