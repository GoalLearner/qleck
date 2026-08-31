// Local nudges (ROADMAP P4): a morning "today's reps" note and an evening
// streak-at-risk note, derived from the same temporal layer Today renders
// from — never a server push. Everything is rebuilt from scratch on every
// reschedule (goals, check-ins or prefs changed, app foregrounded), so the
// pending set always mirrors reality: banking today's last rep cancels
// tonight's nudge, a muted goal vanishes from tomorrow's, a finished goal
// goes quiet everywhere.
//
// The OS permission is requested at FIRST PROTOCOL ACCEPTANCE (in-app), or
// on the first Home mount after the funnel — never inside the funnel itself
// (P3 rule). A prior denial degrades to the Settings deep-link in You.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { ActiveGoalLike, CheckIn } from './protocolTime';
import { addDays, missedTwice, repsForDate } from './protocolTime';
import { localDate } from '../api/device';

export interface NudgePrefs {
  enabled: boolean;
  /** Minutes from local midnight. */
  morning: number;
  evening: number;
  /** Goal ids excluded from nudging. */
  muted: string[];
}

export const DEFAULT_NUDGE_PREFS: NudgePrefs = {
  enabled: true,
  morning: 8 * 60 + 30,   // 08:30
  evening: 20 * 60 + 30,  // 20:30
  muted: [],
};

const PREFS_KEY = 'qleck-nudges';
const DAYS_AHEAD = 7; // 7 days × ≤2 notifications stays far under iOS's 64-pending cap

export async function loadNudgePrefs(): Promise<NudgePrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_NUDGE_PREFS };
    const parsed = JSON.parse(raw) as Partial<NudgePrefs>;
    return {
      enabled: parsed.enabled !== false,
      morning: Number.isFinite(parsed.morning) ? (parsed.morning as number) : DEFAULT_NUDGE_PREFS.morning,
      evening: Number.isFinite(parsed.evening) ? (parsed.evening as number) : DEFAULT_NUDGE_PREFS.evening,
      muted: Array.isArray(parsed.muted) ? parsed.muted.filter(m => typeof m === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_NUDGE_PREFS };
  }
}

type PrefsListener = (prefs: NudgePrefs) => void;
const listeners = new Set<PrefsListener>();

/** Settings saves through here so the manager reschedules immediately. */
export async function saveNudgePrefs(prefs: NudgePrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  for (const fn of listeners) fn(prefs);
}

export function onNudgePrefsChanged(fn: PrefsListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const fmtTime = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
};

/* ── permission ─────────────────────────────────────────────────────────── */

export type NudgePermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

async function notifications() {
  return import('expo-notifications');
}

export async function getNudgePermission(): Promise<NudgePermission> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const N = await notifications();
    const s = await N.getPermissionsAsync();
    if (s.granted) return 'granted';
    return s.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Ask iff the OS still allows asking. Called at first protocol acceptance —
 *  never from the funnel. */
export async function ensureNudgePermission(): Promise<NudgePermission> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const N = await notifications();
    const current = await N.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'denied';
    const asked = await N.requestPermissionsAsync();
    return asked.granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/* ── the scheduler ──────────────────────────────────────────────────────── */

let handlerInstalled = false;
async function installHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  const N = await notifications();
  // While the app is OPEN the surface itself is the nudge — stay silent.
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false, shouldShowBanner: false, shouldShowList: false,
      shouldPlaySound: false, shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('nudges', {
      name: 'Daily reps',
      importance: N.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
}

const dateAt = (local: string, minutes: number): Date => {
  const [y, m, d] = local.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
};

/**
 * Rebuild every pending nudge from current state. Idempotent by design:
 * cancel all, then lay down the next 7 days. Returns how many were laid
 * (for the settings screen's honesty line and the dev log).
 */
export async function rescheduleNudges(
  goals: ActiveGoalLike[],
  byGoal: Record<string, CheckIn[]>,
  prefs: NudgePrefs,
): Promise<number> {
  if (Platform.OS === 'web') return 0;
  let N;
  try {
    N = await notifications();
    await installHandler();
    await N.cancelAllScheduledNotificationsAsync();
  } catch {
    return 0;
  }
  if (!prefs.enabled) return 0;
  if ((await getNudgePermission()) !== 'granted') return 0;

  const active = goals.filter(g => !prefs.muted.includes(g.id));
  if (active.length === 0) return 0;
  const today = localDate();
  const now = new Date();
  let laid = 0;

  const nameOf = (g: ActiveGoalLike) => {
    const t = (g.protocol as { short_title?: string }).short_title?.trim();
    return t && t.split(/\s+/).length <= 9 ? t : 'your goal';
  };

  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const date = addDays(today, offset);
    const perGoal = active
      .map(g => ({ g, reps: repsForDate(g.protocol, g.startedOn, date, byGoal[g.id] ?? []) }))
      .filter(x => x.reps.length > 0);
    if (perGoal.length === 0) continue; // a true rest day nudges nobody
    const lead = perGoal[0];
    const count = perGoal.reduce((n, x) => n + x.reps.length, 0);
    const remainingToday = perGoal.reduce((n, x) => n + x.reps.filter(r => !r.checked).length, 0);
    const slipped = offset === 0 ? perGoal.find(x => missedTwice(x.g.protocol, x.g.startedOn, today, byGoal[x.g.id] ?? [])) : undefined;

    // Morning: what today holds. On a two-miss morning the copy is the
    // comeback, not the checklist.
    const morningAt = dateAt(date, prefs.morning);
    if (morningAt > now && (offset > 0 || remainingToday > 0)) {
      try {
        await N.scheduleNotificationAsync({
          identifier: `qleck-am-${date}`,
          content: slipped
            ? {
                title: `The comeback rep — ${nameOf(slipped.g)}`,
                body: 'Two misses in a row. The rep after a miss is the one that decides the habit — one small rep today restarts it.',
              }
            : {
                title: count === 1 ? `1 rep today — ${nameOf(lead.g)}` : `${count} reps today`,
                body: count === 1
                  ? `${lead.reps[0].step.title}. One check keeps the week honest.`
                  : `${nameOf(lead.g)} leads. Start with the easiest one.`,
              },
          trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: morningAt },
        });
        laid++;
      } catch { /* one bad slot never blocks the rest */ }
    }

    // Evening: streak-at-risk. Today's is only laid while reps remain — the
    // next reschedule after the last check-in clears it. Future evenings are
    // always laid: if the app never opens that day, the reps are certainly
    // unbanked and the nudge is right.
    const eveningAt = dateAt(date, prefs.evening);
    if (eveningAt > now && (offset > 0 || remainingToday > 0)) {
      try {
        await N.scheduleNotificationAsync({
          identifier: `qleck-pm-${date}`,
          content: {
            title: 'Still open tonight',
            body: offset === 0 && remainingToday > 0
              ? `${remainingToday} rep${remainingToday === 1 ? '' : 's'} unbanked — ${nameOf(lead.g)}. Tonight keeps the streak alive.`
              : `Reps are waiting on ${nameOf(lead.g)} — a small one before bed still counts.`,
          },
          trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: eveningAt },
        });
        laid++;
      } catch { /* one bad slot never blocks the rest */ }
    }
  }
  return laid;
}
