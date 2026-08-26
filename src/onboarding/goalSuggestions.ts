// The "or steal one" chips. A chip is never offered for something the user is
// already doing (owner call 2026-08-25) — and "already doing" is judged by
// DOMAIN, not wording: quit smoking / vaping / cigarettes / nicotine are one
// domain, so locking any of them retires the whole family. Filtered chips are
// replaced from the tail of the pool, so the row always shows SHOWN_COUNT.
//
// No AI call: the pool is ours, so each entry carries its own synonym net.
// Keywords stay specific — a generic word like "habit" would match half the
// protocol statements in the app and silently eat the whole row.
import { night } from './theme';

export type SuggestionKind = 'duration' | 'quantity' | 'binary';

export interface Suggestion {
  label: string;
  domain: string;
  kind: SuggestionKind;
}

// Colors are resolved at RENDER time from the live Qoach palette, never stored
// on the suggestion — a module-level color freezes to whichever appearance
// happened to load first.
export function suggestionLook(kind: SuggestionKind) {
  if (kind === 'duration') return { g: 'D', c: night.blue, bg: night.accentSoft, bd: night.border };
  if (kind === 'quantity') return { g: '#', c: night.violetText, bg: night.accentSoft, bd: night.border };
  return { g: '✓', c: night.accentText, bg: night.accentTint, bd: night.accentBorder };
}

function sg(kind: SuggestionKind, label: string, domain: string): Suggestion {
  return { label, domain, kind };
}

/** The row's size — the canvas shows six. */
export const SHOWN_COUNT = 6;

// Order matters: the first six that survive filtering are what you see, so
// the top of the pool is the canvas' original set and the tail is the bench.
export const SUGGESTION_POOL: Suggestion[] = [
  sg('duration', 'Run a 5k', 'running'),
  sg('quantity', 'Lose 10 lbs', 'weight'),
  sg('binary', 'Quit smoking', 'nicotine'),
  sg('quantity', 'Save $5,000', 'money'),
  sg('duration', 'Read 12 books this year', 'reading'),
  sg('binary', 'Gym 3 mornings a week', 'strength'),
  // bench — swapped in when one above is already being worked on
  sg('duration', 'Meditate 10 minutes a day', 'meditation'),
  sg('binary', 'In bed by 11pm', 'sleep'),
  sg('quantity', 'Cut screen time in half', 'screentime'),
  sg('duration', 'Learn conversational Spanish', 'language'),
  sg('binary', 'Cook dinner 4 nights a week', 'cooking'),
  sg('quantity', 'Do 20 clean pull-ups', 'calisthenics'),
  sg('binary', 'No alcohol for 30 days', 'alcohol'),
  sg('duration', 'Practice guitar every day', 'instrument'),
  sg('quantity', '10,000 steps a day', 'steps'),
  sg('binary', 'Journal every morning', 'journaling'),
];

// One synonym net per domain. Matched against the user's goal statements with
// word boundaries, so "run" won't fire on "running errands" style prose but
// will on "run a 4k".
const DOMAIN_TERMS: Record<string, string[]> = {
  running: ['run', 'runs', 'running', 'jog', 'jogging', '5k', '10k', '4k', 'marathon', 'half-marathon', 'couch to 5k'],
  weight: ['lose weight', 'weight loss', 'lose \\d+ ?(lbs|lb|pounds|kg|kilos)', 'drop \\d+ ?(lbs|lb|pounds|kg|kilos)', 'body fat', 'slim down', 'get lean', 'cut weight'],
  nicotine: ['smoking', 'smoke', 'smoker', 'cigarette', 'cigarettes', 'cigs', 'vape', 'vaping', 'vaper', 'nicotine', 'tobacco', 'juul', 'quit smoking'],
  money: ['save', 'saving', 'savings', 'budget', 'budgeting', 'emergency fund', 'pay off', 'debt', 'spending'],
  reading: ['read', 'reads', 'reading', 'book', 'books', 'novel', 'novels'],
  strength: ['gym', 'lift', 'lifting', 'weights', 'strength', 'workout', 'workouts', 'bench press', 'squat', 'deadlift', 'resistance training'],
  meditation: ['meditate', 'meditation', 'mindfulness', 'breathwork'],
  sleep: ['sleep', 'asleep', 'bedtime', 'in bed by', 'wake up earlier', 'insomnia'],
  screentime: ['screen time', 'screentime', 'doomscroll', 'doomscrolling', 'scrolling', 'scroll', 'phone use', 'social media', 'tiktok', 'instagram'],
  language: ['spanish', 'french', 'german', 'japanese', 'mandarin', 'italian', 'portuguese', 'korean', 'language', 'duolingo'],
  cooking: ['cook', 'cooking', 'meal prep', 'home-cooked', 'takeout', 'eat out', 'recipes'],
  calisthenics: ['pull-up', 'pull-ups', 'pullup', 'pullups', 'push-up', 'push-ups', 'pushup', 'pushups', 'calisthenics', 'dips'],
  alcohol: ['alcohol', 'drinking', 'drinks', 'beer', 'wine', 'booze', 'sober', 'sobriety', 'dry january'],
  instrument: ['guitar', 'piano', 'drums', 'violin', 'bass', 'instrument', 'ukulele'],
  steps: ['steps', 'step count', 'walk', 'walking', '10,000 steps', '10k steps'],
  journaling: ['journal', 'journaling', 'diary', 'gratitude log'],
};

const DOMAIN_RE: Record<string, RegExp> = Object.fromEntries(
  Object.entries(DOMAIN_TERMS).map(([domain, terms]) => [
    domain,
    // escape literal terms, keep the few that are already regex fragments
    new RegExp(`\\b(${terms.map(t => (/\\d|\\\(/.test(t) ? t : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|')})\\b`, 'i'),
  ]),
);

/** Domains the user is already working on, from their goal statements. */
export function activeDomains(statements: string[]): Set<string> {
  const hay = statements.join(' \n ').toLowerCase();
  const taken = new Set<string>();
  for (const [domain, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(hay)) taken.add(domain);
  }
  return taken;
}

/**
 * SHOWN_COUNT chips that avoid what the user already has in flight. Falls back
 * to the head of the pool if somehow everything is filtered out — an empty row
 * would look broken, and a redundant chip beats no chip.
 */
export function suggestionsFor(statements: string[], count = SHOWN_COUNT): Suggestion[] {
  const taken = activeDomains(statements);
  const free = SUGGESTION_POOL.filter(s => !taken.has(s.domain));
  if (free.length >= count) return free.slice(0, count);
  const filler = SUGGESTION_POOL.filter(s => !free.includes(s)).slice(0, count - free.length);
  return [...free, ...filler];
}
