import { CatKey } from '../theme';

// One of the mock friends (keyed by a short letter id, e.g. 'm' for Maya).
export type FriendKey = 'm' | 'j' | 'p' | 's' | 'l' | 'n' | 'd';

export interface Friend {
  i: string; // avatar initial
  name: string;
  c: string; // avatar bg
  d: string; // avatar fg
  tag: string; // one-liner shown in the friend picker
}

export type RsvpStatus = 'going' | 'maybe' | 'out' | null;

export interface RallyEvent {
  id: string;
  title: string;
  day: string; // e.g. 'THU'
  num: string; // date number as shown on the tile
  ord: number; // sort order within the week
  time: string; // e.g. 'Thu · 6:30 AM'
  place: string;
  hk: FriendKey; // host key ('d' = you)
  note: string;
  cat: CatKey;
  status: RsvpStatus; // your RSVP
  att: FriendKey[]; // attendees (besides you)
  hosting: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  sub: string;
  streak: number;
  done: boolean; // checked in today
  week: number[]; // Mon..Sun, 1 = checked in
  board: [FriendKey, number][]; // leaderboard: (friend, check-ins this month)
}

export type CreateKind = 'plan' | 'challenge';
export type Audience = 'picks' | 'open';

export interface Draft {
  kind: CreateKind;
  title: string;
  dayIdx: number;
  timeIdx: number;
  place: string;
  aud: Audience;
}
