/**
 * The write queues' rules — check-ins and goals — kept import-free so
 * `outboxPolicy.check.mjs` can run the real drain loop against a fake store.
 *
 * Two ways ticks went missing, both found 15 Sep:
 *
 * 1. ONE REFUSED ITEM STALLED EVERYTHING BEHIND IT. The check-in flush stopped
 *    at the first non-2xx and treated it as "still offline". A tick on a goal
 *    the server never saved gets 400 goal_not_found every time, so from that
 *    tick on nothing else ever sent. Both testers were stuck this way from
 *    8 Sep: a plan locked in a shape the server refused was parked on the
 *    phone, and their first tick on it froze the queue.
 *
 * 2. A FLUSH ERASED WHAT WAS QUEUED DURING IT. The flush read the queue once
 *    and wrote its own shrinking copy back after every send, so a rep ticked
 *    while a send was in flight was overwritten. The goal queue did the same
 *    with a plan locked mid-flush.
 *
 * So: every read-modify-write of a queue goes through one lock, the drain
 * re-reads the queue before every step, and a refused item is HELD — kept,
 * skipped, retried next pass — with only its own group (a goal's later
 * ticks) waiting behind it. Nothing is ever dropped: a silent drop is exactly
 * how a user's work disappears.
 */

export type Outcome = 'sent' | 'later' | 'hold';

/**
 * What a server answer means for a queued write.
 * - sent:  it landed; take it off the queue.
 * - later: the network, the server or the session isn't ready (no answer,
 *          401 before a refresh, 408, 425, 429, 5xx). Stop this pass and keep
 *          everything — the next launch, reconnect or tick tries again.
 * - hold:  the server refused THIS item (any other 4xx). Keep it, skip it and
 *          its group for the rest of the pass, and carry on with the others.
 */
export function outcomeFor(status: number | null): Outcome {
  if (status === null) return 'later';
  if (status >= 200 && status < 300) return 'sent';
  if (status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'later';
  return 'hold';
}

/** One-at-a-time lock. Every function passed in runs after the previous one
 *  settles, success or failure, so read-modify-write cycles never interleave. */
export function makeLock(): <R>(fn: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return <R>(fn: () => Promise<R>): Promise<R> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export interface QueueStore<T> {
  read(): Promise<T[]>;
  write(items: T[]): Promise<void>;
}

export interface DrainOptions<T extends { id: string }> {
  store: QueueStore<T>;
  lock: <R>(fn: () => Promise<R>) => Promise<R>;
  /** Resolves with the HTTP status, or null when there was no answer. */
  send: (item: T) => Promise<number | null>;
  /** Items in one group keep their order: once one is held, the group's later
   *  items wait with it (a goal's ticks and un-ticks must land in order). */
  groupOf: (item: T) => string;
  /** Leave an item alone this pass without sending it (a goal parked under
   *  the current retry epoch). */
  skip?: (item: T) => boolean;
  /** Called with a refused item; a returned value replaces it in the queue. */
  onHold?: (item: T, status: number | null) => T | null | undefined;
}

export interface DrainResult { sent: number; held: number; stopped: boolean }

/** Send what can be sent, in queue order, re-reading the queue every step. */
export async function drainQueue<T extends { id: string }>(o: DrainOptions<T>): Promise<DrainResult> {
  const tried = new Set<string>();
  const heldGroups = new Set<string>();
  let sent = 0;
  let held = 0;
  for (;;) {
    const items = await o.lock(() => o.store.read());
    const next = items.find(i =>
      !tried.has(i.id) && !heldGroups.has(o.groupOf(i)) && !(o.skip ? o.skip(i) : false));
    if (!next) return { sent, held, stopped: false };
    tried.add(next.id);
    let status: number | null;
    try { status = await o.send(next); } catch { status = null; }
    const outcome = outcomeFor(status);
    if (outcome === 'sent') {
      await o.lock(async () => o.store.write((await o.store.read()).filter(i => i.id !== next.id)));
      sent++;
      continue;
    }
    if (outcome === 'hold') {
      heldGroups.add(o.groupOf(next));
      held++;
      const replacement = o.onHold ? o.onHold(next, status) : undefined;
      if (replacement) {
        await o.lock(async () => o.store.write((await o.store.read()).map(i => (i.id === next.id ? replacement : i))));
      }
      continue;
    }
    return { sent, held, stopped: true };
  }
}

/**
 * A goal the server refused is PARKED: still listed on the phone, not retried
 * every pass. But a refusal can be fixed on the server (15 Sep: POST /goals
 * learned to heal the plan shape it used to reject), and a parked goal would
 * never find out. So parking records an epoch, and bumping GOAL_RETRY_EPOCH
 * in a build gives every goal parked under an older one exactly one more try.
 * Goals parked before epochs existed count as epoch 1.
 */
export const GOAL_RETRY_EPOCH = 2;

export function isSettledPark(item: { rejected?: boolean; rejectedEpoch?: number }, epoch = GOAL_RETRY_EPOCH): boolean {
  return !!item.rejected && (item.rejectedEpoch ?? 1) >= epoch;
}

export function parked<T extends object>(item: T, epoch = GOAL_RETRY_EPOCH): T & { rejected: true; rejectedEpoch: number } {
  return { ...item, rejected: true, rejectedEpoch: epoch };
}
