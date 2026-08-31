// The Rally-era social state machine — MOCK ONLY (ROADMAP P2b).
//
// Everything here was in RallyContext until P2b split the provider in two.
// The rule that split created, and which must hold:
//
//     demo may read the real app;  the real app may never read demo.
//
// So this file imports `useRally` (for your name and initial) and nothing in
// `src/state/` or the live screens imports anything from `src/demo/`. That
// one-way arrow is what retires the dual-model leak: no mock person can reach
// real data, and no real identity is expressed as a FriendKey.
//
// None of this is mounted today — the Rally-era routes are gone from the
// shell (owner call 2026-08-24, "the app is purely the coach"). It returns on
// real backends at P6, at which point the toy types are REPLACED, not
// migrated. See ./README.md.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DAYMAP, DAY_OPTIONS, DUMPLING, FRIENDS, INITIAL_ACHIEVEMENTS, INITIAL_CHALLENGES,
  INITIAL_EVENTS, INITIAL_POLLS, JOG, PICKABLE_FRIENDS, TARGET_OPTIONS, TIME_OPTIONS,
} from './mockData';
import {
  Achievement, Challenge, Draft, Friend, FriendKey, Poll, RallyEvent, RsvpStatus,
} from './types';
import { useRally } from '../state/RallyContext';

interface DemoState {
  /** FRIENDS with 'd' ("you") rewritten from the live profile, so your own name
   *  and initial are right everywhere a mock friend is rendered. */
  people: Record<FriendKey, Friend>;
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

const DemoContext = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  // The one-way arrow: demo reads the real profile for your own name/initial.
  const { profile } = useRally();
  const [events, setEvents] = useState<RallyEvent[]>(INITIAL_EVENTS);
  const [challenges, setChallenges] = useState<Challenge[]>(INITIAL_CHALLENGES);
  const [polls, setPolls] = useState<Poll[]>(INITIAL_POLLS);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);
  const [following, setFollowing] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PICKABLE_FRIENDS.map(k => [k, true])));
  const [inviteState, setInviteState] = useState<'yes' | 'no' | null>(null);
  const [jogState, setJogState] = useState<'joined' | null>(null);
  const [lastSent, setLastSent] = useState<DemoState['lastSent']>(null);

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

  const value = useMemo<DemoState>(() => ({
    people, events, challenges, polls, achievements, following, inviteState, jogState, lastSent,
    setRsvp, checkIn, respondInvite, joinJog, sendRally, toggleFollow, vote, cheer, logTeamProgress,
  }), [people, events, challenges, polls, achievements, following, inviteState, jogState, lastSent,
    setRsvp, checkIn, respondInvite, joinJog, sendRally, toggleFollow, vote, cheer, logTeamProgress]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    throw new Error(
      'useDemo must be used inside DemoProvider — the Rally-era demo world is ' +
      'unmounted (see src/demo/README.md; flip DEMO_ENABLED and mount DemoProvider to revive it).',
    );
  }
  return ctx;
}

/* ── derived helpers shared by the demo screens ─────────────────────────── */

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
