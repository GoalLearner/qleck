import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCurrentGoal, saveGoal } from '../api/goals';
import { fetchCheckIns, flushOutbox, submitCheckIn } from '../api/checkins';
import { localDate } from '../api/device';
import type { CheckIn } from '../lib/protocolTime';
import {
  DAYMAP, DAY_OPTIONS, DUMPLING, FRIENDS, INITIAL_ACHIEVEMENTS, INITIAL_CHALLENGES,
  INITIAL_EVENTS, INITIAL_POLLS, JOG, PICKABLE_FRIENDS, TARGET_OPTIONS, TIME_OPTIONS,
} from '../data/mockData';
import {
  Achievement, Challenge, Draft, Friend, FriendKey, Poll, RallyEvent, RsvpStatus, UserProfile,
} from '../data/types';
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

// The demo's in-memory state machine (originally ported from the design
// canvas' DCLogic; extended with follow/polls/cheers/team challenges).
interface RallyState {
  profile: UserProfile;
  // FRIENDS with 'd' ("you") rewritten from the live profile, so your own name
  // and initial are right everywhere a friend is rendered.
  people: Record<FriendKey, Friend>;
  applyOnboarding: (result: OnboardingResult) => void;
  // In-app "+" goal creation: replaces the current goal (P1 is single-goal;
  // multiple concurrent goals arrive with the living-protocol phase).
  setGoalPlan: (plan: AcceptedPlan) => void;
  // The monitoring record for the active goal (P2a). goalStartedOn feeds the
  // temporal layer; checkInStep is optimistic + outbox-backed.
  goalId: string | null;
  goalStartedOn: string;
  checkIns: CheckIn[];
  checkInStep: (stepId: string, value?: number | null) => void;
  events: RallyEvent[];
  challenges: Challenge[];
  polls: Poll[];
  achievements: Achievement[];
  following: Record<string, boolean>;
  inviteState: 'yes' | 'no' | null; // Leo's dumpling-crawl invite
  jogState: 'joined' | null; // Priya's open jog invite
  lastSent: { avKeys: FriendKey[]; draft: Draft } | null;
  setRsvp: (eventId: string, status: RsvpStatus) => void;
  checkIn: (challengeId: string) => void;
  respondInvite: (accept: boolean) => void;
  joinJog: () => void;
  sendRally: (draft: Draft, picked: FriendKey[]) => void;
  toggleFollow: (key: FriendKey) => void;
  vote: (pollId: string, optionIdx: number) => void;
  cheer: (achievementId: string) => void;
  logTeamProgress: (challengeId: string, amount: number) => void;
}

const RallyContext = createContext<RallyState | null>(null);

export function RallyProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<RallyEvent[]>(INITIAL_EVENTS);
  const [challenges, setChallenges] = useState<Challenge[]>(INITIAL_CHALLENGES);
  const [polls, setPolls] = useState<Poll[]>(INITIAL_POLLS);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);
  const [following, setFollowing] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PICKABLE_FRIENDS.map(k => [k, true])));
  const [inviteState, setInviteState] = useState<'yes' | 'no' | null>(null);
  const [jogState, setJogState] = useState<'joined' | null>(null);
  const [lastSent, setLastSent] = useState<RallyState['lastSent']>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goalStartedOn, setGoalStartedOn] = useState<string>(localDate());
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const hydratedRef = useRef(false);

  // P2a hydration: cached profile first (instant, offline-friendly), then the
  // server's active goal wins for goal fields. Persist changes thereafter.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('qleck-profile');
        hydratedRef.current = true;
        if (raw) {
          const cached = JSON.parse(raw) as Partial<UserProfile>;
          setProfile(prev => ({ ...prev, ...cached }));
        }
      } catch { hydratedRef.current = true; }
      try {
        await flushOutbox();
        const goal = await fetchCurrentGoal();
        if (goal) {
          setProfile(prev => ({
            ...prev,
            firstGoal: goal.statement,
            goalPeriod: `${goal.duration_weeks} weeks`,
            protocol: goal.protocol,
          }));
          setGoalId(goal.id);
          setGoalStartedOn(goal.started_on);
          setCheckIns(await fetchCheckIns(goal.id, goal.started_on, localDate()));
        }
      } catch { /* offline: cache already applied */ }
    })();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem('qleck-profile', JSON.stringify(profile)).catch(() => {});
  }, [profile]);

  const applyOnboarding = useCallback((result: OnboardingResult) => {
    setProfile(prev => profileFromOnboarding(prev, result));
    if (result.protocol && result.goal) {
      saveGoal(
        {
          goalText: result.goal,
          statement: result.goal,
          durationWeeks: parseInt(result.period ?? '', 10) || result.protocol.duration_weeks,
          protocol: result.protocol,
        },
        result.goal,
      )
        .then(goal => { setGoalId(goal.id); setGoalStartedOn(goal.started_on); })
        .catch(err => console.warn('goal save deferred:', err));
    }
  }, []);

  const setGoalPlan = useCallback((plan: AcceptedPlan) => {
    setProfile(prev => ({
      ...prev,
      firstGoal: plan.statement,
      goalPeriod: `${plan.durationWeeks} weeks`,
      protocol: plan.protocol,
    }));
    setGoalStartedOn(localDate());
    setCheckIns([]);
    // Write-through; the local state stays authoritative for this session and
    // the next launch re-hydrates from the server.
    saveGoal(plan, plan.goalText)
      .then(goal => setGoalId(goal.id))
      .catch(err => console.warn('goal save deferred:', err));
  }, []);

  const checkInStep = useCallback((stepId: string, value: number | null = null) => {
    const today = localDate();
    setCheckIns(prev => {
      if (prev.some(c => c.step_id === stepId && c.local_date === today)) return prev;
      return [...prev, { id: 'pending', step_id: stepId, local_date: today, value }];
    });
    if (goalId) {
      void submitCheckIn(goalId, stepId, today, value).then(row => {
        setCheckIns(prev => prev.map(c =>
          c.id === 'pending' && c.step_id === stepId && c.local_date === today ? row : c));
      });
    }
  }, [goalId]);

  const people = useMemo<Record<FriendKey, Friend>>(() => ({
    ...FRIENDS,
    d: { ...FRIENDS.d, i: profile.initials, name: 'You' },
  }), [profile.initials]);

  const setRsvp = useCallback((eventId: string, status: RsvpStatus) => {
    setEvents(evs => evs.map(e => (e.id === eventId ? { ...e, status } : e)));
  }, []);

  const checkIn = useCallback((challengeId: string) => {
    setChallenges(chs => chs.map(c => {
      if (c.id !== challengeId || c.done) return c;
      const week = [...c.week];
      week[6] = 1;
      return { ...c, done: true, streak: c.streak + 1, week };
    }));
  }, []);

  const respondInvite = useCallback((accept: boolean) => {
    setInviteState(accept ? 'yes' : 'no');
    if (accept) setEvents(evs => (evs.find(e => e.id === DUMPLING.id) ? evs : [...evs, DUMPLING]));
  }, []);

  const joinJog = useCallback(() => {
    setJogState('joined');
    setEvents(evs => (evs.find(e => e.id === JOG.id) ? evs : [...evs, JOG]));
  }, []);

  const toggleFollow = useCallback((key: FriendKey) => {
    setFollowing(f => ({ ...f, [key]: !f[key] }));
  }, []);

  const vote = useCallback((pollId: string, optionIdx: number) => {
    setPolls(ps => ps.map(p => {
      if (p.id !== pollId) return p;
      const options = p.options.map((o, i) => ({
        ...o,
        votes: i === optionIdx
          ? (o.votes.includes('d') ? o.votes : [...o.votes, 'd' as FriendKey])
          : o.votes.filter(k => k !== 'd'),
      }));
      return { ...p, options, myVote: optionIdx };
    }));
  }, []);

  const cheer = useCallback((achievementId: string) => {
    setAchievements(as => as.map(a =>
      a.id === achievementId && !a.cheeredByMe
        ? { ...a, cheeredByMe: true, cheers: [...a.cheers, 'd' as FriendKey] }
        : a));
  }, []);

  const logTeamProgress = useCallback((challengeId: string, amount: number) => {
    setChallenges(chs => chs.map(c => {
      if (c.id !== challengeId || c.kind !== 'team' || !c.contributions) return c;
      const has = c.contributions.some(([k]) => k === 'd');
      const contributions: [FriendKey, number][] = has
        ? c.contributions.map(([k, v]) => (k === 'd' ? [k, +(v + amount).toFixed(1)] : [k, v]))
        : [...c.contributions, ['d', amount]];
      return { ...c, contributions };
    }));
  }, []);

  const sendRally = useCallback((draft: Draft, picked: FriendKey[]) => {
    if (draft.kind === 'poll') {
      const filled = draft.pollOptions.map(o => o.trim()).filter(Boolean);
      const q: Poll = {
        id: 'nq' + Date.now(),
        question: draft.title.trim() || 'Quick poll',
        by: 'd', group: draft.aud === 'open' ? 'Everyone invited' : 'Your picks',
        options: (filled.length >= 2 ? filled : ['Yes', 'No']).map(label => ({ label, votes: [] })),
        myVote: null,
      };
      setPolls(ps => [q, ...ps]);
      setLastSent({ avKeys: picked, draft });
      return;
    }
    const dayL = DAY_OPTIONS[draft.dayIdx];
    const timeL = TIME_OPTIONS[draft.timeIdx];
    const dm = DAYMAP[dayL];
    const title = draft.title.trim() || 'New plan';
    if (draft.kind === 'plan') {
      const ne: RallyEvent = {
        id: 'ne' + Date.now(), title, day: dm[0], num: dm[1], ord: dm[2],
        time: `${dayL} · ${timeL}`, place: draft.place.trim() || 'Place TBD', hk: 'd',
        note: draft.aud === 'open'
          ? 'Open invite — anyone on Qleck can join.'
          : 'You made this. Legend.',
        cat: 'rose', status: 'going', att: picked, hosting: true,
      };
      setEvents(evs => [...evs, ne]);
    } else if (draft.challengeKind === 'team') {
      const nc: Challenge = {
        id: 'nc' + Date.now(), kind: 'team', title,
        sub: `${picked.length + 1} friends · just started`,
        streak: 0, done: false, week: [0, 0, 0, 0, 0, 0, 0], board: [],
        unit: 'km', target: TARGET_OPTIONS[draft.targetIdx],
        contributions: [['d', 0], ...picked.map(k => [k, 0] as [FriendKey, number])],
      };
      setChallenges(chs => [...chs, nc]);
    } else {
      const nc: Challenge = {
        id: 'nc' + Date.now(), kind: 'streak', title,
        sub: `${picked.length + 1} friends · just started`,
        streak: 0, done: false, week: [0, 0, 0, 0, 0, 0, 0],
        board: [['d', 0], ...picked.map(k => [k, 0] as [FriendKey, number])],
      };
      setChallenges(chs => [...chs, nc]);
    }
    setLastSent({ avKeys: picked, draft });
  }, []);

  const value = useMemo<RallyState>(() => ({
    profile, people, applyOnboarding, setGoalPlan,
    goalId, goalStartedOn, checkIns, checkInStep,
    events, challenges, polls, achievements, following, inviteState, jogState, lastSent,
    setRsvp, checkIn, respondInvite, joinJog, sendRally, toggleFollow, vote, cheer, logTeamProgress,
  }), [profile, people, applyOnboarding, setGoalPlan,
    goalId, goalStartedOn, checkIns, checkInStep,
    events, challenges, polls, achievements, following, inviteState, jogState, lastSent,
    setRsvp, checkIn, respondInvite, joinJog, sendRally, toggleFollow, vote, cheer, logTeamProgress]);

  return <RallyContext.Provider value={value}>{children}</RallyContext.Provider>;
}

export function useRally(): RallyState {
  const ctx = useContext(RallyContext);
  if (!ctx) throw new Error('useRally must be used inside RallyProvider');
  return ctx;
}

// ---- Derived helpers shared by screens ----

export function sortedEvents(events: RallyEvent[]): RallyEvent[] {
  return [...events].sort((a, b) => a.ord - b.ord);
}

export function nextUp(events: RallyEvent[]): RallyEvent | undefined {
  const evs = sortedEvents(events);
  return evs.find(e => e.status === 'going' || e.hosting) || evs[0];
}

export function statusPill(e: RallyEvent): { t: string; bg: string; fg: string } {
  if (e.hosting) return { t: 'Hosting', bg: '#e4e6f4', fg: '#4d5680' };
  if (e.status === 'going') return { t: "You're in", bg: '#dcecdf', fg: '#47694f' };
  if (e.status === 'maybe') return { t: 'Maybe', bg: '#f2ecd2', fg: '#7a6c35' };
  if (e.status === 'out') return { t: "Can't go", bg: '#f0eee6', fg: '#9a978c' };
  return { t: 'RSVP →', bg: '#e6eaf2', fg: '#46536a' };
}

export function weekProgress(ch: Challenge): number {
  return ch.week.reduce((a, b) => a + b, 0) / 7;
}

export function teamTotal(ch: Challenge): number {
  return +(ch.contributions ?? []).reduce((a, [, v]) => a + v, 0).toFixed(1);
}
