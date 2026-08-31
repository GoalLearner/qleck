// Check-in client with the P2a offline outbox — the ONE flow that queues
// (roadmap: check-ins are append-mostly and genuinely offline; everything
// else is online-required). Client-minted ids + server INSERT OR IGNORE make
// endless replays safe.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckIn } from '../lib/protocolTime';
import { authedFetch } from './device';

const OUTBOX_KEY = 'qleck-checkin-outbox';
const CACHE_KEY = 'qleck-checkins'; // Record<goalId, CheckIn[]> across active goals

interface OutboxItem {
  id: string;
  goalId: string;
  stepId: string;
  localDate: string;
  value: number | null;
  /** Missing = 'add' (items queued before un-check shipped). */
  op?: 'add' | 'remove';
}

function mintId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch { return []; }
}

async function writeOutbox(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items)).catch(() => {});
}

async function post(item: OutboxItem): Promise<boolean> {
  try {
    if (item.op === 'remove') {
      const qs = `goalId=${item.goalId}&stepId=${encodeURIComponent(item.stepId)}&date=${item.localDate}`;
      const res = await authedFetch(`/check-ins?${qs}`, { method: 'DELETE' });
      return res.ok;
    }
    const res = await authedFetch('/check-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    return res.ok;
  } catch { return false; }
}

/** Queue-then-send. Returns the optimistic CheckIn for immediate render. */
export async function submitCheckIn(
  goalId: string, stepId: string, localDate: string, value: number | null = null,
): Promise<CheckIn> {
  const item: OutboxItem = { id: mintId(), goalId, stepId, localDate, value, op: 'add' };
  await writeOutbox([...(await readOutbox()), item]);
  void flushOutbox();
  return { id: item.id, step_id: stepId, local_date: localDate, value };
}

/** Un-check: queue-then-send delete, ordered after any pending add. */
export async function removeCheckIn(goalId: string, stepId: string, localDate: string): Promise<void> {
  const item: OutboxItem = { id: mintId(), goalId, stepId, localDate, value: null, op: 'remove' };
  await writeOutbox([...(await readOutbox()), item]);
  void flushOutbox();
}

let flushing = false;
/** Drain the outbox; safe to call any time (launch, reconnect, post-check). */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let items = await readOutbox();
    while (items.length > 0) {
      const ok = await post(items[0]);
      if (!ok) break; // still offline — keep the queue intact
      items = items.slice(1);
      await writeOutbox(items);
    }
  } finally { flushing = false; }
}

async function readCache(): Promise<Record<string, CheckIn[]>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown> & { goalId?: string; rows?: CheckIn[] };
    // Pre-multi-goal shape was {goalId, rows}; fold it into the map.
    if (typeof parsed.goalId === 'string' && Array.isArray(parsed.rows)) {
      return { [parsed.goalId]: parsed.rows };
    }
    return parsed as Record<string, CheckIn[]>;
  } catch { return {}; }
}

/** Server truth for a goal's check-ins, cached per goal for offline rendering. */
export async function fetchCheckIns(goalId: string, from: string, to: string): Promise<CheckIn[]> {
  try {
    const res = await authedFetch(`/check-ins?goalId=${goalId}&from=${from}&to=${to}`);
    if (!res.ok) throw new Error(String(res.status));
    const rows = ((await res.json()) as { checkIns: CheckIn[] }).checkIns;
    const cache = await readCache();
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [goalId]: rows })).catch(() => {});
    return rows;
  } catch {
    // Offline: cached rows with the queued ops replayed in order on top.
    try {
      let rows: CheckIn[] = (await readCache())[goalId] ?? [];
      for (const i of (await readOutbox()).filter(i => i.goalId === goalId)) {
        if (i.op === 'remove') {
          rows = rows.filter(r => !(r.step_id === i.stepId && r.local_date === i.localDate));
        } else if (!rows.some(r => r.id === i.id)) {
          rows = [...rows, { id: i.id, step_id: i.stepId, local_date: i.localDate, value: i.value }];
        }
      }
      return rows;
    } catch { return []; }
  }
}
