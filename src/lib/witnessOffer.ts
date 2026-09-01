// When to offer someone a witness (owner call 2026-09-01).
//
// The witness link was built at P4.5 and then sat at the bottom of the goal
// detail, below the plan, the tweak link, Pause and Drop. The owner — who
// asked for the feature — did not know it was in the build. Moving the card
// above the plan made it findable; this makes it TIMELY, which is the half
// that actually matters. Nobody wants a witness on day one. They want one
// once there is something worth showing.
//
// So Today offers it once per goal, after a real streak exists. The rules are
// deliberately conservative, because an offer that arrives twice reads as
// nagging and an offer that arrives at zero reads as noise:
//
//   * a streak of WITNESS_STREAK_DAYS or more, counted the same way Today
//     counts it (consecutive days with a check-in, today or yesterday-anchored)
//   * never for a goal already being watched — the link exists, the job is done
//   * never for a paused goal, which by definition is not building anything
//   * once per goal, ever. Taking the offer or waving it away both settle it.
//
// Like the milestone seen-set, what is stored here is only whether we ASKED.
// Streaks are still derived at read time; losing this record can cause one
// repeated offer, never a false claim about the work.
//
// The RULE itself lives in protocolTime.ts next to streakDays, because that is
// where this codebase keeps pure temporal logic — which is also what lets the
// fixtures run it under plain node.
import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFERED_KEY = 'qleck-witness-offered';

export async function loadOfferedWitness(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFERED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function markWitnessOffered(goalId: string): Promise<void> {
  if (!goalId) return;
  try {
    const current = await loadOfferedWitness();
    if (current.includes(goalId)) return;
    await AsyncStorage.setItem(OFFERED_KEY, JSON.stringify([...current, goalId]));
  } catch { /* a lost record only risks asking once more, never a false streak */ }
}
