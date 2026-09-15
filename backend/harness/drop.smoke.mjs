// Ticking reps off a plan, against a LIVE worker (local by default).
//
//   npm run smoke:drop
//
// Paid: one interview, one plan, three re-prices (~$0.08). Proves what
// drop.check cannot — that the route prices the set on screen, refuses only
// an empty plan (a physique pillar can come off, with the cost stated), keeps
// the stored plan whole so ticking a rep back on is a re-price, and still
// answers the old commitment picker.
import { execSync } from 'node:child_process';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const SECRET = process.env.HARNESS_SECRET ?? 'local-dev-harness';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000d40b';
const LOCAL = BASE.includes('127.0.0.1') || BASE.includes('localhost');
const GOAL = 'Put on 10 lbs of muscle. I am 173 lbs, lift 3 days a week, and eat whatever is around.';
const ANSWER = 'Whatever you think is realistic — I have a normal schedule and average fitness.';
const JOB_WAIT_MS = 300_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body, attempt = 0) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': DEVICE, 'X-Qleck-Harness': SECRET },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    if (attempt >= 2) throw err;                 // `wrangler dev` drops sockets
    await sleep(600);
    return api(path, body, attempt + 1);
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const sql = q => {
  if (!LOCAL) return null;
  const out = execSync(`npx wrangler d1 execute qleck --local --json --command "${q.replace(/\s+/g, ' ')}"`, {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\//, ''), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.replace(/^[^[]*/, ''))[0].results[0];
};

let pass = 0; const failures = [];
const bar = (name, cond, note = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${note ? ` — ${note}` : ''}`); }
};
const stepsOf = p => p.phases.flatMap(ph => ph.steps);

console.log(`\nticking reps off a plan → ${BASE}\n`);

/* the interview, then the plan */
let turn = await api('/coach/sessions', { goalText: GOAL });
const id = turn.body.sessionId;
for (let i = 0; i < 8 && turn.body.type === 'question'; i++) {
  turn = await api(`/coach/sessions/${id}/messages`, { answer: ANSWER });
}
bar('the goal reaches a verdict', turn.status === 200 && turn.body.type === 'verdict', `${turn.status} ${turn.body.error ?? turn.body.type}`);
if (!id || turn.body.type !== 'verdict') { console.log('\nNO VERDICT — stopping\n'); process.exit(1); }

let built = await api(`/coach/sessions/${id}/protocol`, { async: true });
const deadline = Date.now() + JOB_WAIT_MS;
while (built.body.type === 'building' && Date.now() < deadline) {
  await sleep(2500);
  built = await api(`/coach/sessions/${id}/protocol`, { async: true });
}
bar('the plan is built', built.status === 200 && built.body.type === 'protocol', `${built.status} ${built.body.type ?? built.body.error}`);
const full = built.body.protocol;
if (!full) { console.log('\nNO PLAN — stopping\n'); process.exit(1); }
const all = stepsOf(full);
const ceiling = sql(`SELECT odds_ceiling FROM coach_sessions WHERE id = '${id}'`)?.odds_ceiling ?? null;
console.log(`  · ${all.length} reps, ceiling ${ceiling ?? '—'}`);

/* a pillar rep comes off — the thing the old picker refused outright */
const pillar = all.find(s => /protein|sleep|bed/i.test(`${s.title} ${s.details}`)) ?? all[all.length - 1];
const first = await api(`/coach/sessions/${id}/protocol/reprice`, { unticked_step_ids: [pillar.id] });
bar('a pillar rep can be ticked off (the old picker refused this)', first.status === 200 && typeof first.body.odds === 'number',
  `${first.status} ${JSON.stringify(first.body).slice(0, 110)}`);
bar('the priced plan comes back without it', !!first.body.protocol && !stepsOf(first.body.protocol).some(s => s.id === pillar.id));
bar('the price never beats the plan as designed', ceiling === null || first.body.odds <= ceiling, `${first.body.odds} vs ${ceiling}`);
bar('the cost is stated in the app’s own words', typeof first.body.cost === 'string' && first.body.cost.length > 0, String(first.body.cost));
let row = sql(`SELECT plan_odds, drop_ids, protocol FROM coach_sessions WHERE id = '${id}'`);
bar('the stored plan stays whole, and the price says which set it is for',
  !row || (stepsOf(JSON.parse(row.protocol)).length === all.length && JSON.parse(row.drop_ids).join() === pillar.id && row.plan_odds === first.body.odds),
  row && `${stepsOf(JSON.parse(row.protocol)).length}/${all.length} · ${row.drop_ids}`);

/* one more off: strictly less plan cannot be worth more */
const second = all.find(s => s.id !== pillar.id);
const grown = await api(`/coach/sessions/${id}/protocol/reprice`, { unticked_step_ids: [pillar.id, second.id] });
bar('two off is priced no higher than one off', grown.status === 200 && grown.body.odds <= first.body.odds,
  `${grown.body.odds} vs ${first.body.odds}`);

/* everything back on: the plan as designed, at its own price, no model call */
const t0 = Date.now();
const back = await api(`/coach/sessions/${id}/protocol/reprice`, { unticked_step_ids: [] });
const ms = Date.now() - t0;
bar('ticking everything back on restores the plan and its own price',
  back.status === 200 && stepsOf(back.body.protocol).length === all.length && (ceiling === null || back.body.odds === ceiling),
  `${back.status} ${back.body.odds} vs ${ceiling}`);
bar('…without spending a model call', ms < 1500, `${ms}ms`);
row = sql(`SELECT plan_odds, drop_ids FROM coach_sessions WHERE id = '${id}'`);
bar('…and the recorded set is cleared', !row || row.drop_ids === null, row && String(row.drop_ids));

/* the one refusal */
const empty = await api(`/coach/sessions/${id}/protocol/reprice`, { unticked_step_ids: all.map(s => s.id) });
bar('a plan with nothing left is the only refusal', empty.status === 400 && empty.body.error === 'empty_plan',
  `${empty.status} ${JSON.stringify(empty.body).slice(0, 80)}`);

/* builds ≤35 still work */
const legacy = await api(`/coach/sessions/${id}/protocol/reprice`, { dropped_step_ids: [second.id] });
bar('the old commitment picker still answers', legacy.status === 200 && (typeof legacy.body.odds === 'number' || Array.isArray(legacy.body.refused)),
  `${legacy.status} ${JSON.stringify(legacy.body).slice(0, 80)}`);

/* ── "Not for me", on a plan that is already running ──────────────────── */
{
  const reg = await api('/device/register', {});
  const token = reg.body?.token;
  const auth = async (path, body, method = 'POST') => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const goalId = crypto.randomUUID();
  const made = await auth('/goals', {
    id: goalId, goalText: 'muscle', statement: full.goal_statement, durationWeeks: full.duration_weeks,
    successProbability: 80, startedOn: new Date().toLocaleDateString('en-CA'), timezone: 'Europe/Oslo', protocol: full,
  });
  bar('the plan locks as a live goal', made.status >= 200 && made.status < 300 && !!made.body.goal, `${made.status} ${JSON.stringify(made.body).slice(0, 120)}`);

  // Week 2 of a real multi-phase plan: the rep is retired here and gone from
  // the phases that have not started.
  const pillarStep = full.phases[0].steps.find(s => /protein|sleep|bed/i.test(`${s.title} ${s.details}`)) ?? full.phases[0].steps[0];
  const priced = await auth(`/goals/${goalId}/steps/drop`, {
    stepIds: [pillarStep.id], currentWeek: 2, protocolId: crypto.randomUUID(), baseVersion: 1,
  });
  bar('"Not for me" prices the plan without it', priced.status === 200 && typeof priced.body.odds === 'number',
    `${priced.status} ${JSON.stringify(priced.body).slice(0, 140)}`);
  bar('…and the number can only go down', (priced.body.odds ?? 0) <= 80, `${priced.body.odds} vs 80`);
  const lived = priced.body.goal?.protocol?.phases?.[0]?.steps?.find(s => s.id === pillarStep.id);
  bar('…while the rep stays in the phase being lived, marked from week 2', lived?.retired_from_week === 2, JSON.stringify(lived?.retired_from_week));
  bar('…and the cost is stated when it costs a pillar', priced.body.cost === null || typeof priced.body.cost === 'string', String(priced.body.cost));
  console.log(`  · odds 80 → ${priced.body.odds}${priced.body.cost ? ` · ${priced.body.cost}` : ''}`);
  await auth(`/goals/${goalId}`, undefined, 'DELETE');
}

console.log(`\n${failures.length ? `DROP SMOKE FAILED · ${failures.length} of ${pass + failures.length}` : `DROP SMOKE CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
