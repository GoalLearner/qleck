import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DAYMAP, DAY_OPTIONS, DUMPLING, INITIAL_CHALLENGES, INITIAL_EVENTS, JOG, TIME_OPTIONS,
} from '../data/mockData';
import { Challenge, Draft, FriendKey, RallyEvent, RsvpStatus } from '../data/types';

// Ported from the design canvas' DCLogic state machine.
interface RallyState {
  userName: string;
  events: RallyEvent[];
  challenges: Challenge[];
  inviteState: 'yes' | 'no' | null; // Leo's dumpling-crawl invite
  jogState: 'joined' | null; // Priya's open jog invite
  lastSent: { avKeys: FriendKey[]; draft: Draft } | null;
  setRsvp: (eventId: string, status: RsvpStatus) => void;
  checkIn: (challengeId: string) => void;
  respondInvite: (accept: boolean) => void;
  joinJog: () => void;
  sendRally: (draft: Draft, picked: FriendKey[]) => void;
}

const RallyContext = createContext<RallyState | null>(null);

export function RallyProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<RallyEvent[]>(INITIAL_EVENTS);
  const [challenges, setChallenges] = useState<Challenge[]>(INITIAL_CHALLENGES);
  const [inviteState, setInviteState] = useState<'yes' | 'no' | null>(null);
  const [jogState, setJogState] = useState<'joined' | null>(null);
  const [lastSent, setLastSent] = useState<RallyState['lastSent']>(null);

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

  const sendRally = useCallback((draft: Draft, picked: FriendKey[]) => {
    const dayL = DAY_OPTIONS[draft.dayIdx];
    const timeL = TIME_OPTIONS[draft.timeIdx];
    const dm = DAYMAP[dayL];
    const title = draft.title.trim() || 'New rally';
    if (draft.kind === 'plan') {
      const ne: RallyEvent = {
        id: 'ne' + Date.now(), title, day: dm[0], num: dm[1], ord: dm[2],
        time: `${dayL} · ${timeL}`, place: draft.place.trim() || 'Place TBD', hk: 'd',
        note: draft.aud === 'open'
          ? 'Open invite — anyone on Rally can join.'
          : 'You made this. Legend.',
        cat: 'rose', status: 'going', att: picked, hosting: true,
      };
      setEvents(evs => [...evs, ne]);
    } else {
      const nc: Challenge = {
        id: 'nc' + Date.now(), title,
        sub: `${picked.length + 1} friends · just started`,
        streak: 0, done: false, week: [0, 0, 0, 0, 0, 0, 0],
        board: [['d', 0], ...picked.map(k => [k, 0] as [FriendKey, number])],
      };
      setChallenges(chs => [...chs, nc]);
    }
    setLastSent({ avKeys: picked, draft });
  }, []);

  const value = useMemo<RallyState>(() => ({
    userName: 'Dana',
    events, challenges, inviteState, jogState, lastSent,
    setRsvp, checkIn, respondInvite, joinJog, sendRally,
  }), [events, challenges, inviteState, jogState, lastSent, setRsvp, checkIn, respondInvite, joinJog, sendRally]);

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
