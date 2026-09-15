// The session rules, checked WITHOUT the model.
//
//   node harness/session.check.mjs
//
// sessionErrors decides whether a rep knows which days it lives on. It is
// BLOCKING, so every false positive costs a whole generation attempt —
// roughly twenty seconds and a model call — and three of those in a row is
// the difference between a plan arriving and the app looking like it hung.
// Production retry payloads traced most of the waiting straight to here, so
// the rule now has bars that cost nothing to run.
import { alignStepsToSessions, sessionErrors, validateProtocol } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];

const plan = (steps, sessions) => ({
  schema_version: 1,
  goal_statement: 'Run a half marathon',
  duration_weeks: 12,
  ...(sessions ? { sessions } : {}),
  phases: [{
    id: 'p1', title: 'Build the base', focus: 'Three runs a week.',
    start_week: 1, end_week: 12, steps,
  }],
  milestones: [],
  coach_notes: '',
});

const step = (over = {}) => ({
  id: 's1', title: 'Easy run', kind: 'binary',
  frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] },
  details: 'Conversational pace.',
  ...over,
});

function bar(name, { steps, sessions, complains }) {
  const errs = sessionErrors(plan(steps, sessions));
  const got = errs.length > 0;
  if (got === complains) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name}`);
  console.log(`        expected ${complains ? 'a complaint' : 'silence'}, got ${got ? errs[0] : 'silence'}`);
}

console.log('\nsession rules\n');

/* ── the harm the rule exists to stop ───────────────────────────────────── */
bar('a conditional rep with no session AND no days is refused', {
  steps: [step({ title: 'Log the session', details: 'After each run, write down the pace.', frequency: { per_week: 3 } })],
  complains: true,
});

/* ── the false positive that was costing an attempt every time ──────────── */
bar('a conditional rep that carries its own days is fine', {
  steps: [step({ title: 'Log the session', details: 'After each run, write down the pace.' })],
  complains: false,
});

/* ── attached steps still have to agree with their session ──────────────── */
bar('an attached step whose days disagree is refused', {
  sessions: [{ id: 'sess1', type: 'run', days: ['mon'] }],
  steps: [step({ session_id: 'sess1' })],
  complains: true,
});
bar('an attached step matching its session is fine', {
  sessions: [{ id: 'sess1', type: 'run', days: ['mon', 'wed', 'fri'] }],
  steps: [step({ session_id: 'sess1' })],
  complains: false,
});
bar('an attached step with no days at all is refused', {
  sessions: [{ id: 'sess1', type: 'run', days: ['mon'] }],
  steps: [step({ session_id: 'sess1', frequency: { per_week: 1 } })],
  complains: true,
});
bar('a step pointing at a session that does not exist is refused', {
  sessions: [{ id: 'sess1', type: 'run', days: ['mon', 'wed', 'fri'] }],
  steps: [step({ session_id: 'ghost' })],
  complains: true,
});
bar('per_week above the session\'s day count is refused', {
  sessions: [{ id: 'sess1', type: 'run', days: ['mon'] }],
  steps: [step({ session_id: 'sess1', frequency: { per_week: 3, days: ['mon'] } })],
  complains: true,
});

/* ── the ordinary plan ──────────────────────────────────────────────────── */
bar('a plain quota rep with no session is fine', {
  steps: [step({ title: 'Run 3 times', details: 'Any three days.', frequency: { per_week: 3 } })],
  complains: false,
});
bar('a malformed session is still caught', {
  sessions: [{ id: 'sess1', type: 'run', days: [] }],
  steps: [step({ session_id: 'sess1' })],
  complains: true,
});

/* ── the repair must leave a shape BOTH validators accept (15 Sep) ──────── */
// alignStepsToSessions used to only lower per_week. A rep given one of its
// session's days came out days = the session's, per_week unchanged — which
// sessionErrors accepts and validateProtocol (and so POST /goals) rejects.
function aligned(name, { steps, sessions, wantPerWeek, wantDays }) {
  const p = plan(steps, sessions);
  let threw = false;
  try { alignStepsToSessions(p); } catch { threw = true; }
  const st = p.phases[0].steps[0];
  const structural = validateProtocol(p).filter(e => /per_week|days list/.test(e));
  const ok = !threw && structural.length === 0 && sessionErrors(p).length === 0
    && (wantPerWeek === undefined || st.frequency.per_week === wantPerWeek)
    && (wantDays === undefined || [...st.frequency.days].sort().join(',') === wantDays);
  if (ok) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name}${threw ? ' (threw)' : ''} → per_week ${st.frequency?.per_week}, days ${st.frequency?.days}, ${[...structural, ...sessionErrors(p)].join(' | ')}`);
}
const twoDay = [{ id: 'lift', type: 'lift', days: ['mon', 'thu'] }];
const fiveDay = [{ id: 'walk', type: 'walk', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }];
aligned('a rep on ONE of a two-day session\'s days comes out 2/wk on both (the production shape)', {
  steps: [step({ session_id: 'lift', frequency: { per_week: 1, days: ['mon'] } })], sessions: twoDay,
  wantPerWeek: 2, wantDays: 'mon,thu',
});
aligned('3/wk on a five-day session becomes 5/wk on its days', {
  steps: [step({ session_id: 'walk', frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] } })], sessions: fiveDay,
  wantPerWeek: 5, wantDays: 'fri,mon,thu,tue,wed',
});
aligned('an already-matching rep with a short count is raised to the session\'s days', {
  steps: [step({ session_id: 'lift', frequency: { per_week: 1, days: ['mon', 'thu'] } })], sessions: twoDay,
  wantPerWeek: 2,
});
aligned('3/wk on a one-day session still comes down to 1', {
  steps: [step({ session_id: 'sun', frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] } })],
  sessions: [{ id: 'sun', type: 'long run', days: ['sun'] }],
  wantPerWeek: 1, wantDays: 'sun',
});
{
  const p = plan([{ id: 's1', title: 'Log the lift', kind: 'binary', session_id: 'lift', details: 'x' }], twoDay);
  let threw = false;
  try { alignStepsToSessions(p); } catch { threw = true; }
  if (!threw) { pass++; console.log('  PASS  a rep with no frequency object does not throw (left to the validator)'); }
  else { failures.push('no-frequency rep threw'); console.log('  FAIL  a rep with no frequency object does not throw'); }
}

console.log(`\n${failures.length ? `SESSION CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `SESSION CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
