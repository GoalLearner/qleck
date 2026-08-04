import { Challenge, Friend, FriendKey, RallyEvent } from './types';

// Mock cast — matches the design canvas exactly.
export const FRIENDS: Record<FriendKey, Friend> = {
  m: { i: 'M', name: 'Maya', c: '#e4e6f4', d: '#4d5680', tag: 'Always in' },
  j: { i: 'J', name: 'Jonas', c: '#dcecdf', d: '#47694f', tag: 'Flaky but fun' },
  p: { i: 'P', name: 'Priya', c: '#f6e5d4', d: '#8a5f38', tag: 'The planner' },
  s: { i: 'S', name: 'Sam', c: '#f2ecd2', d: '#7a6c35', tag: 'Snack dealer' },
  l: { i: 'L', name: 'Leo', c: '#dde9f2', d: '#3f5e78', tag: 'Chaos agent' },
  n: { i: 'N', name: 'Nia', c: '#f4e0e0', d: '#8a4f4f', tag: 'New here' },
  d: { i: 'D', name: 'You', c: '#e6eaf2', d: '#46536a', tag: '' },
};

export const PICKABLE_FRIENDS: FriendKey[] = ['m', 'j', 'p', 's', 'l', 'n'];

export const INITIAL_EVENTS: RallyEvent[] = [
  {
    id: 'e1', title: 'Run Club', day: 'THU', num: '6', ord: 6,
    time: 'Thu · 6:30 AM', place: 'Riverside loop', hk: 'm',
    note: 'Easy 5k, coffee after. No one gets left behind.',
    cat: 'mint', status: 'going', att: ['m', 'j', 'p'], hosting: false,
  },
  {
    id: 'e2', title: 'Game Night', day: 'FRI', num: '7', ord: 7,
    time: 'Fri · 7:00 PM', place: "Sam's place", hk: 's',
    note: 'Bring a game or bring snacks. Ideally both.',
    cat: 'lav', status: null, att: ['s', 'l', 'n'], hosting: false,
  },
  {
    id: 'e3', title: 'Pottery drop-in', day: 'SUN', num: '9', ord: 9,
    time: 'Sun · 2:00 PM', place: 'Clay & Co studio', hk: 'd',
    note: 'Beginners welcome. Aprons provided.',
    cat: 'peach', status: 'going', att: ['n', 'p'], hosting: true,
  },
];

// Pending invite from Leo (accepting adds this to your plans)
export const DUMPLING: RallyEvent = {
  id: 'e4', title: 'Dumpling crawl', day: 'SAT', num: '8', ord: 8,
  time: 'Sat · 12:30 PM', place: 'Golden Palace', hk: 'l',
  note: 'Cash only. Come hungry.',
  cat: 'butter', status: 'going', att: ['l', 'n'], hosting: false,
};

// Priya's open invite (joining adds this to your plans)
export const JOG: RallyEvent = {
  id: 'e5', title: 'Morning jog', day: 'WED', num: '5', ord: 5,
  time: 'Tomorrow · 7:00 AM', place: 'River path', hk: 'p',
  note: 'Open invite — anyone on Rally can join. Easy pace, all welcome.',
  cat: 'mint', status: 'going', att: ['p', 'j'], hosting: false,
};

export const INITIAL_CHALLENGES: Challenge[] = [
  {
    id: 'c1', title: '10k steps a day', sub: 'August · 8 friends',
    streak: 6, done: false, week: [1, 1, 0, 1, 1, 1, 0],
    board: [['p', 28], ['d', 26], ['j', 24], ['m', 19], ['s', 15]],
  },
  {
    id: 'c2', title: 'Read 20 pages', sub: 'Daily · 5 friends',
    streak: 12, done: true, week: [1, 1, 1, 1, 1, 1, 1],
    board: [['n', 31], ['d', 29], ['l', 22]],
  },
];

export const DAY_OPTIONS = ['Today', 'Tomorrow', 'Saturday', 'Sunday'] as const;
export const TIME_OPTIONS = ['Morning', 'Noon', 'Evening', 'Night'] as const;

// Day option → [tile day label, tile number, week sort order]
export const DAYMAP: Record<string, [string, string, number]> = {
  Today: ['TUE', '4', 4],
  Tomorrow: ['WED', '5', 5],
  Saturday: ['SAT', '8', 8],
  Sunday: ['SUN', '9', 9],
};
