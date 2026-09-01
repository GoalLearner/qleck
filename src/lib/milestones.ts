// Which milestone celebrations have already been shown (ROADMAP P4).
//
// Attainment itself is NEVER stored — it is derived at read time by
// `reachedMilestones` in protocolTime.ts, per the schema's binding
// invariant. What lives here is the far smaller fact of whether we already
// threw the party: a notification record, not a claim about the truth. Losing
// it can only cause a repeat celebration, never a false one.
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'qleck-milestones-seen';

export async function loadSeenMilestones(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function markMilestonesSeen(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const current = await loadSeenMilestones();
    const merged = [...new Set([...current, ...keys])];
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(merged));
  } catch { /* a lost record only risks celebrating twice, never a false one */ }
}
