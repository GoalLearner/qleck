// Check-in client with the P2a offline outbox — the ONE flow that queues
// (roadmap: check-ins are append-mostly and genuinely offline; everything
// else is online-required). Client-minted ids + server INSERT OR IGNORE make
// endless replays safe.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckIn } from '../lib/protocolTime';
import { apiBase, getIdentity } from './device';

const OUTBOX_KEY = 'qleck-checkin-outbox';
const CACHE_KEY = 'qleck-checkins'; // per current goal

interface OutboxItem {
  id: string;
  goalId: string;
  stepId: string;
  localDate: string;
  value: number | null;
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
    const { token } = await getIdentity();
    const res = await fetch(apiBase() + '/check-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(item),
    });
    return res.ok;
  } catch { return false; }
}

/** Queue-then-send. Returns the optimistic CheckIn for immediate render. */
export async function submitCheckIn(
  goalId: string, stepId: string, localDate: string, value: number | null = null,
): Promise<CheckIn> {
  const item: OutboxItem = { id: mintId(), goalId, stepId, localDate, value };
  await writeOutbox([...(await readOutbox()), item]);
  void flushOutbox();
  return { id: item.id, step_id: stepId, local_date: localDate, value };
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

/** Server truth for a goal's check-ins, cached for offline rendering. */
export async function fetchCheckIns(goalId: string, from: string, to: string): Promise<CheckIn[]> {
  try {
    const { token } = await getIdentity();
    const res = await fetch(
      `${apiBase()}/check-ins?goalId=${goalId}&from=${from}&to=${to}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const rows = ((await res.json()) as { checkIns: CheckIn[] }).checkIns;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ goalId, rows })).catch(() => {});
    return rows;
  } catch {
    // Offline: cached rows plus anything still queued for this goal.
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      const cached = raw ? (JSON.parse(raw) as { goalId: string; rows: CheckIn[] }) : null;
      const queued = (await readOutbox())
        .filter(i => i.goalId === goalId)
        .map(i => ({ id: i.id, step_id: i.stepId, local_date: i.localDate, value: i.value }));
      const base = cached?.goalId === goalId ? cached.rows : [];
      const seen = new Set(base.map(r => r.id));
      return [...base, ...queued.filter(q => !seen.has(q.id))];
    } catch { return []; }
  }
}
