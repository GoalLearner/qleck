import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  abandonGoal, clearGoalOutbox, completeGoal, fetchFinishedGoals, fetchGoals, flushGoalOutbox,
  deleteGoal, graduateGoal, mintGoalId, pauseGoal, pendingGoals, resumeGoal, saveGoal,
  shareGoal, unshareGoal, type RemoteGoal,
} from '../api/goals';
import { fetchCheckIns, flushOutbox, removeCheckIn, submitCheckIn } from '../api/checkins';
import { getStoredIdentity, localDate, resetIdentity } from '../api/device';
import { fetchMe, logoutServer, saveMe } from '../api/account';
import { resetDeviceId } from '../api/coach';
import { planIsOver, planStats, type CheckIn } from '../lib/protocolTime';
import { UserProfile } from '../data/types';
import { AVATAR_GRADS } from '../onboarding/theme';
import type { OnboardingResult } from '../onboarding/useOnboardingFlow';
import type { AcceptedPlan } from '../onboarding/useCoachFlow';

// Before onboarding runs (and for anyone who signs in without re-registering)
// this is who you are — the demo's original "Dana".
export const DEFAULT_PROFILE: UserProfile = {
  firstName: 'Dana',
  fullName: 'Dana Whitfield',
  handle: 'dana',
  initials: 'D',
  avatarColors: null,
  firstGoal: null,
  goalPeriod: null,
  protocol: null,
  allowNotifications: false,
  allowMotion: false,
};

// An active goal as the app lives it: the locked protocol plus the fields the
// temporal layer needs. Mirrors the server's goals table.
export interface ActiveGoal {
  id: string;
  /** The odds the plan was accepted at (chosen pace), when known. */
  odds?: number;
  startedOn: string;
  statement: string;
  durationWeeks: number;
  protocol: NonNullable<UserProfile['protocol']>;
  /** 'active' | 'paused' for anything in the running list (P4). Absent on
   *  goals cached by builds ≤16, which are all active by definition. */
  status?: string;
  /** P4.5: the witness link's secret while this goal is shared. Owner-only. */
  shareToken?: string | null;
}

// The funnel only knows what it actually asked for: the log-in path collects no
// name at all, so anything blank keeps the default rather than wiping it.
function profileFromOnboarding(prev: UserProfile, r: OnboardingResult): UserProfile {
  const name = r.name.trim();
  const parts = name ? name.split(/\s+/) : [];
  return {
    firstName: parts[0] || prev.firstName,
    fullName: name || prev.fullName,
    handle: r.username || prev.handle,
    initials: parts.length
      ? parts.map(w => w[0]).slice(0, 2).join('').toUpperCase()
      : prev.initials,
    avatarColors: r.avatar > 0 ? AVATAR_GRADS[r.avatar] : prev.avatarColors,
    firstGoal: r.goal ?? prev.firstGoal,
    goalPeriod: r.goal ? r.period : prev.goalPeriod,
    protocol: r.protocol ?? prev.protocol,
    allowNotifications: r.allowNotifications,
    allowMotion: r.allowMotion,
  };
}

// The REAL app's state: who you are, your goals, and your check-ins.
//
// P2b split this provider in two. The Rally-era social world (mock people,
// events, challenges, polls, the follow graph) moved wholesale to
// `src/demo/DemoContext.tsx`, and the arrow only points one way: demo reads
// this, this never reads demo. Nothing below may import from `src/demo/` —
// `npm run check:demo` enforces it.
interface RallyState {
  profile: UserProfile;
  /** The server's user UUID for this device — the app's ONLY identity. It
   *  replaced the demo's `'d'` sentinel at P2b. null while the identity is
   *  still being read (first launch, or offline before registration). */
  currentUserId: string | null;
  applyOnboarding: (result: OnboardingResult) => void;
  // In-app "+" goal creation: appends another concurrent goal (owner call
  // 2026-08-24 — goals coexist; Today renders them as groups).
  setGoalPlan: (plan: AcceptedPlan) => void;
  // Every active goal plus its monitoring record (P2a). Check-ins are
  // optimistic + outbox-backed, keyed per goal.
  goals: ActiveGoal[];
  /** Goals still inside their run — what Today schedules reps from. */
  liveGoals: ActiveGoal[];
  /** Goals whose plan ran out but which haven't been graduated yet. These are
   *  still 'active' server-side: the ceremony waits for the user rather than a
   *  cron deciding on their behalf. */
  endedGoals: ActiveGoal[];
  /** On ice (P4): schedules nothing, nudges nothing, keeps its place. */
  pausedGoals: ActiveGoal[];
  /** The archive — completed or dropped, newest first. */
  finishedGoals: ActiveGoal[];
  checkInsByGoal: Record<string, CheckIn[]>;
  checkInStep: (goalId: string, stepId: string, value?: number | null) => void;
  // Un-check (the canvas' toggling check): today only, mirrored to the server.
  uncheckStep: (goalId: string, stepId: string) => void;
  // Explicit drop — the only way a goal ends now that creation never replaces.
  dropGoal: (goalId: string) => void;
  /** P4: pause / resume. Resuming pays back the paused days server-side. */
  pauseGoalById: (goalId: string) => Promise<void>;
  resumeGoalById: (goalId: string) => Promise<void>;
  /** P4: erase a goal and everything hanging off it. Nothing is archived. */
  deleteGoalById: (goalId: string) => Promise<void>;
  /** P4.5: let one person watch this goal (returns the link), or stop. */
  shareGoalById: (goalId: string) => Promise<string>;
  unshareGoalById: (goalId: string) => Promise<void>;
  /** Close out a finished plan: it moves to the archive and goes quiet. */
  completeGoalById: (goalId: string) => Promise<void>;
  /** Carry a finished plan forward — longer, or as a lighter maintenance goal. */
  graduate: (goalId: string, mode: 'extend' | 'maintain', weeks?: number) => Promise<void>;
  /** Re-read goals from the server. The adjust flow owns its own two API calls
   *  (propose returns data the caller needs), so it re-syncs through this. */
  refreshGoals: () => Promise<void>;
  /** Clear this device's identity + caches (logout). */
  signOut: () => Promise<void>;
}

const RallyContext = createContext<RallyState | null>(null);

export function RallyProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [goals, setGoals] = useState<ActiveGoal[]>([]);
  const [finishedGoals, setFinishedGoals] = useState<ActiveGoal[]>([]);
  const [checkInsByGoal, setCheckInsByGoal] = useState<Record<string, CheckIn[]>>({});
  const hydratedRef = useRef(false);

  const toActive = (g: RemoteGoal): ActiveGoal => ({
    id: g.id, startedOn: g.started_on, statement: g.statement,
    durationWeeks: g.duration_weeks, protocol: g.protocol,
    odds: g.success_probability ?? undefined, status: g.status, shareToken: g.share_token ?? null,
  });

  /** Re-read goals + their check-ins from the server. Called on launch and
   *  after anything that changes the goal set (graduation, close-out). */
  const refresh = useCallback(async () => {
    const [remote, archived] = await Promise.all([fetchGoals(), fetchFinishedGoals().catch(() => [])]);
    // Server truth PLUS anything still queued. Without the queued ones a goal
    // whose save has not landed yet would be wiped from the list here — the
    // user would watch a plan they just built disappear.
    const queued = await pendingGoals().catch(() => []);
    const remoteIds = new Set(remote.map(g => g.id));
    const active = [
      ...remote.map(toActive),
      ...queued.filter(q => !remoteIds.has(q.id)).map(q => ({
        id: q.id, startedOn: q.startedOn, statement: q.statement,
        durationWeeks: q.durationWeeks, protocol: q.protocol,
        odds: q.successProbability ?? undefined,
      })),
    ];
    setGoals(active);
    setFinishedGoals(archived.map(toActive));
    const today = localDate();
    const known = active.filter(g => remoteIds.has(g.id));
    const rows = await Promise.all(known.map(g => fetchCheckIns(g.id, g.startedOn, today)));
    setCheckInsByGoal(prev => ({ ...prev, ...Object.fromEntries(known.map((g, i) => [g.id, rows[i]])) }));
  }, []);

  // P2a hydration: cached profile + goals first (instant, offline-friendly),
  // then the server's active-goal list wins. Persist changes thereafter.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('qleck-profile');
        hydratedRef.current = true;
        if (raw) {
          const cached = JSON.parse(raw) as Partial<UserProfile>;
          setProfile(prev => ({ ...prev, ...cached }));
        }
        const goalsRaw = await AsyncStorage.getItem('qleck-goals');
        if (goalsRaw) setGoals(JSON.parse(goalsRaw) as ActiveGoal[]);
      } catch { hydratedRef.current = true; }
      try {
        // The real identity, read once at boot — this is what replaced the
        // demo's 'd' sentinel. Peeked, never registered: a brand-new device
        // registers lazily on its first API call, not because state mounted.
        const identity = await getStoredIdentity().catch(() => null);
        if (identity?.userId) setCurrentUserId(identity.userId);
        await flushGoalOutbox();
        await flushOutbox();
        await refresh();
        // Real accounts (P3): the server's profile wins over the local cache,
        // so a login on a fresh device gets its name and handle back.
        const me = await fetchMe().catch(() => null);
        if (me?.displayName || me?.handle) {
          setProfile(prev => ({
            ...prev,
            fullName: me.displayName ?? prev.fullName,
            firstName: me.displayName ? me.displayName.split(' ')[0] : prev.firstName,
            handle: me.handle ?? prev.handle,
          }));
        }
      } catch { /* offline: cache already applied */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem('qleck-profile', JSON.stringify(profile)).catch(() => {});
  }, [profile]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem('qleck-goals', JSON.stringify(goals)).catch(() => {});
  }, [goals]);

  // Optimistic append with the same client-minted id the server write uses,
  // so check-ins land on the right goal even before the save resolves.
  const addGoal = useCallback((plan: AcceptedPlan) => {
    const id = mintGoalId();
    setGoals(prev => [...prev, {
      id, startedOn: localDate(), statement: plan.statement,
      durationWeeks: plan.durationWeeks, protocol: plan.protocol,
      odds: plan.odds,
    }]);
    // Queued durably, then sent in the background — a failed request retries
    // on the next launch instead of quietly losing the plan.
    saveGoal(plan, plan.goalText, id).catch(err => console.warn('goal queue failed:', err));
  }, []);

  const applyOnboarding = useCallback((result: OnboardingResult) => {
    setProfile(prev => profileFromOnboarding(prev, result));
    // The account's profile lives server-side too (P3): name + handle survive
    // devices. Fire-and-forget; the local cache still applies immediately.
    if (result.name.trim() || result.username.trim()) {
      saveMe(result.name.trim(), result.username.trim()).catch(() => {});
    }
    if (result.protocol && result.goal) {
      addGoal({
        goalText: result.goal,
        statement: result.goal,
        durationWeeks: parseInt(result.period ?? '', 10) || result.protocol.duration_weeks,
        protocol: result.protocol,
      });
    }
  }, [addGoal]);

  const setGoalPlan = useCallback((plan: AcceptedPlan) => {
    addGoal(plan);
  }, [addGoal]);

  const checkInStep = useCallback((goalId: string, stepId: string, value: number | null = null) => {
    const today = localDate();
    setCheckInsByGoal(prev => {
      const rows = prev[goalId] ?? [];
      if (rows.some(c => c.step_id === stepId && c.local_date === today)) return prev;
      return { ...prev, [goalId]: [...rows, { id: 'pending', step_id: stepId, local_date: today, value }] };
    });
    void submitCheckIn(goalId, stepId, today, value).then(row => {
      setCheckInsByGoal(prev => ({
        ...prev,
        [goalId]: (prev[goalId] ?? []).map(c =>
          c.id === 'pending' && c.step_id === stepId && c.local_date === today ? row : c),
      }));
    });
  }, []);

  const uncheckStep = useCallback((goalId: string, stepId: string) => {
    const today = localDate();
    setCheckInsByGoal(prev => ({
      ...prev,
      [goalId]: (prev[goalId] ?? []).filter(c => !(c.step_id === stepId && c.local_date === today)),
    }));
    void removeCheckIn(goalId, stepId, today);
  }, []);

  /**
   * Split by whether the plan still has days left in it. A goal past its end
   * stays 'active' server-side — the graduation moment belongs to the user, so
   * nothing auto-completes behind their back — but Today must stop scheduling
   * reps from it, or an ended plan reads as a permanent rest day.
   */
  const today = localDate();
  // A paused goal schedules nothing and ends nothing: it is out of both lists
  // until it resumes. Because NudgeManager runs off liveGoals, this is also
  // what makes nudges go quiet on a paused goal (P4's "nudges cease on
  // non-active state").
  const liveGoals = useMemo(
    () => goals.filter(g => g.status !== 'paused' && !planIsOver(g.startedOn, g.protocol.duration_weeks, today)),
    [goals, today],
  );
  const endedGoals = useMemo(
    () => goals.filter(g => g.status !== 'paused' && planIsOver(g.startedOn, g.protocol.duration_weeks, today)),
    [goals, today],
  );
  const pausedGoals = useMemo(() => goals.filter(g => g.status === 'paused'), [goals]);

  const completeGoalById = useCallback(async (goalId: string) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
    await completeGoal(goalId);
    await refresh().catch(() => {});
  }, [refresh]);

  const graduate = useCallback(async (
    goalId: string, mode: 'extend' | 'maintain', weeks?: number,
  ) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const stats = planStats(goal.protocol, goal.startedOn, checkInsByGoal[goalId] ?? []);
    await graduateGoal(goalId, mode, localDate(), {
      banked: stats.banked, expected: stats.expected, bestStreak: stats.bestStreak,
      weeks: stats.weeks,
    }, weeks);
    // Server owns the outcome (a new goal for maintain, a new version for
    // extend) — re-read rather than guessing at the local shape.
    await refresh();
  }, [goals, checkInsByGoal, refresh]);

  const dropGoal = useCallback((goalId: string) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setCheckInsByGoal(prev => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
    abandonGoal(goalId).catch(err => console.warn('goal drop deferred:', err));
  }, []);

  /** P4: on ice — optimistic, then the server stamps the pause clock. */
  const pauseGoalById = useCallback(async (goalId: string) => {
    setGoals(prev => prev.map(g => (g.id === goalId ? { ...g, status: 'paused' } : g)));
    await pauseGoal(goalId).catch(err => console.warn('pause deferred:', err));
    // The server owns started_on across a pause/resume pair, so re-read
    // rather than guessing at the shifted date locally.
    await refresh().catch(() => {});
  }, [refresh]);

  const resumeGoalById = useCallback(async (goalId: string) => {
    setGoals(prev => prev.map(g => (g.id === goalId ? { ...g, status: 'active' } : g)));
    await resumeGoal(goalId).catch(err => console.warn('resume deferred:', err));
    await refresh().catch(() => {});
  }, [refresh]);

  /** P4.5: mint (or re-read) this goal's witness link. */
  const shareGoalById = useCallback(async (goalId: string) => {
    const url = await shareGoal(goalId);
    await refresh().catch(() => {});
    return url;
  }, [refresh]);

  const unshareGoalById = useCallback(async (goalId: string) => {
    setGoals(prev => prev.map(g => (g.id === goalId ? { ...g, shareToken: null } : g)));
    await unshareGoal(goalId);
    await refresh().catch(() => {});
  }, [refresh]);

  /** P4: erase it — the goal and every row hanging off it. Unlike dropGoal,
   *  nothing survives in the archive. */
  const deleteGoalById = useCallback(async (goalId: string) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setFinishedGoals(prev => prev.filter(g => g.id !== goalId));
    setCheckInsByGoal(prev => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
    await deleteGoal(goalId);
    await refresh().catch(() => {});
  }, [refresh]);

  /** Logout: forget who this device is and everything cached about them.
   *  An anonymous device's token IS its account, so a lingering identity made
   *  every "new account" the previous one with a fresh name painted on it. */
  const signOut = useCallback(async () => {
    setGoals([]);
    setFinishedGoals([]);
    setCheckInsByGoal({});
    setProfile(DEFAULT_PROFILE);
    setCurrentUserId(null);
    // hydratedRef stays true on purpose: the persist effects must keep running
    // so the NEXT account's goals and profile are cached. They will re-write
    // these keys with the cleared state, which is the same thing this removal
    // does — belt and braces, not a race.
    await AsyncStorage.multiRemove(['qleck-goals', 'qleck-profile', 'qleck-checkin-outbox', 'qleck-checkins']).catch(() => {});
    await clearGoalOutbox();
    // P3: revoke this device's refresh token server-side BEFORE the identity
    // is forgotten — logout must be real, not just local amnesia.
    await logoutServer().catch(() => {});
    await resetIdentity();
    resetDeviceId();
  }, []);

  const value = useMemo<RallyState>(() => ({
    profile, currentUserId, applyOnboarding, setGoalPlan,
    goals, liveGoals, endedGoals, pausedGoals, finishedGoals,
    checkInsByGoal, checkInStep, uncheckStep, dropGoal, completeGoalById, graduate,
    pauseGoalById, resumeGoalById, deleteGoalById, shareGoalById, unshareGoalById,
    refreshGoals: refresh, signOut,
  }), [profile, currentUserId, applyOnboarding, setGoalPlan,
    goals, liveGoals, endedGoals, pausedGoals, finishedGoals,
    checkInsByGoal, checkInStep, uncheckStep, dropGoal, completeGoalById, graduate,
    pauseGoalById, resumeGoalById, deleteGoalById, shareGoalById, unshareGoalById, refresh, signOut]);

  return <RallyContext.Provider value={value}>{children}</RallyContext.Provider>;
}

export function useRally(): RallyState {
  const ctx = useContext(RallyContext);
  if (!ctx) throw new Error('useRally must be used inside RallyProvider');
  return ctx;
}
