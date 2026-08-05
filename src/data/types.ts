import { CatKey } from '../theme';

// One of the mock people (keyed by a short letter id, e.g. 'm' for Maya).
// 'd' = you; 'o'/'t'/'r' are suggested users you don't follow yet.
export type FriendKey = 'm' | 'j' | 'p' | 's' | 'l' | 'n' | 'd' | 'o' | 't' | 'r';

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

export type ChallengeKind = 'streak' | 'team';

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  title: string;
  sub: string;
  // streak kind
  streak: number;
  done: boolean; // checked in today
  week: number[]; // Mon..Sun, 1 = checked in
  board: [FriendKey, number][]; // leaderboard: (friend, check-ins this month)
  // team kind
  unit?: string; // e.g. 'km'
  target?: number; // shared total to hit
  contributions?: [FriendKey, number][];
}

export interface PollOption {
  label: string;
  votes: FriendKey[];
}

export interface Poll {
  id: string;
  question: string;
  by: FriendKey;
  group: string; // e.g. 'Runday crew'
  options: PollOption[];
  myVote: number | null;
}

export interface Achievement {
  id: string;
  who: FriendKey;
  text: string; // e.g. 'hit a 14-day streak on 10k steps'
  cheers: FriendKey[]; // friends who already cheered
  cheeredByMe: boolean;
}

export type CreateKind = 'plan' | 'challenge' | 'poll';
export type Audience = 'picks' | 'open';

export interface Draft {
  kind: CreateKind;
  title: string;
  dayIdx: number;
  timeIdx: number;
  place: string;
  aud: Audience;
  // challenge extras
  challengeKind: ChallengeKind;
  targetIdx: number; // index into TARGET_OPTIONS
  // poll extras
  pollOptions: string[];
}
