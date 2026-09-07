// The draft claim, checked WITHOUT a database or a model.
//
//   node harness/draft.check.mjs
//
// Two code paths generate the same protocol for one session. driveDraft is
// kicked when the verdict is issued and again on every prepare; POST /protocol
// generates in-request whenever there is no draft to accept. Neither knew
// about the other: driveDraft guarded with `draft_protocol IS NULL`, which is
// a read, not a claim.
//
// Production, 7 Sep 06:26 — the verdict kicked a draft, the user tapped "Build
// my plan" 27 seconds later while it was still running, and two full
// generations ran side by side for one plan.
//
// The claim is one conditional UPDATE and the wait is a bounded poll, so both
// can be pinned down with a fake D1 and an injected clock. No model calls.
import { claimDraft, releaseDraft, waitForDraft, DRAFT_CLAIM_MS } from '../src/draftClaim.ts';

let pass = 0;
const failures = [];

const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
};

/** Just enough D1 to answer the three statements draftClaim.ts issues. */
function fakeDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes('SET draft_working_until = ?')) {
                const [until, id, now] = args;
                const r = rows[id];
                const taken = !!r && r.draft_protocol == null
                  && (r.draft_working_until == null || r.draft_working_until < now);
                if (taken) r.draft_working_until = until;
                return { meta: { changes: taken ? 1 : 0 } };
              }
              if (sql.includes('SET draft_working_until = NULL')) {
                const [id, claim] = args;
                const r = rows[id];
                const cleared = !!r && r.draft_working_until === claim;
                if (cleared) r.draft_working_until = null;
                return { meta: { changes: cleared ? 1 : 0 } };
              }
              throw new Error('unexpected SQL: ' + sql);
            },
            async first() {
              const r = rows[args[0]];
              if (!r) return null;
              return {
                has_draft: r.draft_protocol != null ? 1 : 0,
                draft_working_until: r.draft_working_until ?? null,
              };
            },
          };
        },
      };
    },
  };
}

const session = (over = {}) => ({ draft_protocol: null, draft_working_until: null, ...over });

console.log('\ndraft claim\n');

/* ── the claim ──────────────────────────────────────────────────────────── */
{
  const rows = { s1: session() };
  const db = fakeDb(rows);
  const first = await claimDraft(db, 's1', 1000);
  const second = await claimDraft(db, 's1', 1001);
  ok('the first caller gets the claim', first === 1000 + DRAFT_CLAIM_MS);
  ok('the second caller is told no, rather than doing the work twice', second === null);
  ok('the row records who is working', rows.s1.draft_working_until === first);
}
{
  const rows = { s1: session({ draft_protocol: '{}' }) };
  ok('a session that already has a draft cannot be claimed', await claimDraft(fakeDb(rows), 's1', 1000) === null);
}
{
  // The usual ending for a draft is its isolate being torn down, so a claim
  // nobody will ever release has to stop blocking on its own.
  const rows = { s1: session({ draft_working_until: 5_000 }) };
  const late = await claimDraft(fakeDb(rows), 's1', 5_001);
  ok('a lapsed claim can be taken over', late === 5_001 + DRAFT_CLAIM_MS);
}
{
  const rows = { s1: session({ draft_working_until: 90_000 }) };
  ok('a live claim cannot be stolen', await claimDraft(fakeDb(rows), 's1', 89_999) === null);
}
ok('claiming a session that does not exist fails quietly', await claimDraft(fakeDb({}), 'ghost', 1000) === null);

/* ── the release ────────────────────────────────────────────────────────── */
{
  const rows = { s1: session({ draft_working_until: 7777 }) };
  await releaseDraft(fakeDb(rows), 's1', 7777);
  ok('a claim is released by its owner', rows.s1.draft_working_until === null);
}
{
  // Our generation ran long, our claim lapsed, someone else took it. Clearing
  // it now would hand a third caller a claim that is genuinely held.
  const rows = { s1: session({ draft_working_until: 9999 }) };
  await releaseDraft(fakeDb(rows), 's1', 7777);
  ok('a lapsed owner cannot clear the claim that replaced it', rows.s1.draft_working_until === 9999);
}

/* ── the wait ───────────────────────────────────────────────────────────── */
const clock = start => { let t = start; return { now: () => t, advance: ms => { t += ms; } }; };

{
  const rows = { s1: session({ draft_protocol: '{}', draft_working_until: 90_000 }) };
  const c = clock(0);
  let slept = 0;
  const got = await waitForDraft(fakeDb(rows), 's1', { now: c.now, sleep: async ms => { slept += ms; c.advance(ms); } });
  ok('a draft that is already there returns at once', got === true && slept === 0);
}
{
  const rows = { s1: session({ draft_working_until: 90_000 }) };
  const c = clock(0);
  const db = fakeDb(rows);
  let ticks = 0;
  const got = await waitForDraft(db, 's1', {
    now: c.now,
    sleep: async ms => { c.advance(ms); if (++ticks === 3) rows.s1.draft_protocol = '{}'; },
  });
  ok('it returns the moment the other generation lands', got === true && ticks === 3);
}
{
  // The owner is gone. Waiting out the full window would add ten seconds to a
  // wait that is about to become a full generation anyway.
  const rows = { s1: session({ draft_working_until: 500 }) };
  const c = clock(1000);
  let slept = 0;
  const got = await waitForDraft(fakeDb(rows), 's1', { now: c.now, sleep: async ms => { slept += ms; c.advance(ms); } });
  ok('a lapsed claim ends the wait immediately', got === false && slept === 0);
}
{
  const rows = { s1: session() };
  const c = clock(0);
  let slept = 0;
  const got = await waitForDraft(fakeDb(rows), 's1', { now: c.now, sleep: async ms => { slept += ms; c.advance(ms); } });
  ok('nobody working and no draft means do not wait at all', got === false && slept === 0);
}
{
  const rows = { s1: session({ draft_working_until: 10 ** 9 }) };
  const c = clock(0);
  let slept = 0;
  const got = await waitForDraft(fakeDb(rows), 's1', {
    waitMs: 10_000, pollMs: 900, now: c.now,
    sleep: async ms => { slept += ms; c.advance(ms); },
  });
  ok('a draft that never lands gives up at the deadline', got === false);
  ok('and never waits past it', slept <= 10_000);
}
ok('a missing session is not something to wait for', await waitForDraft(fakeDb({}), 'ghost', {}) === false);

console.log(`\n${failures.length ? `DRAFT CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `DRAFT CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
