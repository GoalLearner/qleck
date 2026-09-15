// What a finished plan is allowed to become, checked WITHOUT a model.
//
//   node harness/graduation.check.mjs
//
// "Keep it going, lighter" could not succeed on a short plan: the maintenance
// prompt asks for 4-12 weeks and the server rejected anything longer than
// twice the original run, so a 1-week plan hit "the coach hit a snag" on
// every attempt — including the 3-day test goal, whose whole purpose is to
// reach this screen.
import { readFileSync } from 'node:fs';
import { maintenanceCap, trimToWeeks, spliceFrozenPast, validateProtocol } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const step = id => ({ id, title: id, kind: 'binary', frequency: { per_week: 3 }, details: 'd' });
/** A plan of `weeks` weeks in 4-week phases. */
const planOf = weeks => {
  const phases = [];
  for (let start = 1; start <= weeks; start += 4) {
    const end = Math.min(start + 3, weeks);
    phases.push({ id: `p${phases.length + 1}`, title: `Phase ${phases.length + 1}`, focus: 'f', start_week: start, end_week: end, steps: [step(`p${phases.length + 1}-a`)] });
  }
  return {
    schema_version: 1, goal_statement: 'g', short_title: 'g', duration_weeks: weeks,
    phases, coach_notes: 'n',
    milestones: [{ id: 'm1', week: 1, title: 'one', criteria: 'c' }, { id: 'm2', week: weeks, title: 'end', criteria: 'c' }],
  };
};

console.log('\nwhat a finished plan may become\n');

/* ── the cap ──────────────────────────────────────────────────────────── */
ok('a 1-week plan may maintain for 12 weeks (it could not graduate at all before)', maintenanceCap(1) === 12);
ok('a 6-week plan too — the floor is the prompt’s own ceiling', maintenanceCap(6) === 12);
ok('a 10-week plan may maintain for twice its run', maintenanceCap(10) === 20);
ok('nothing may maintain for more than a year', maintenanceCap(40) === 52 && maintenanceCap(52) === 52);

/* ── the trim ─────────────────────────────────────────────────────────── */
{
  const p = planOf(12);
  const frozen = JSON.stringify(p);
  const cut = trimToWeeks(p, 6);
  ok('trimming leaves the plan it was given alone', JSON.stringify(p) === frozen);
  ok('a plan already inside the cap is returned untouched', trimToWeeks(p, 12) === p && trimToWeeks(p, 20) === p);
  ok('whole phases past the line go', cut.phases.map(ph => ph.id).join() === 'p1,p2');
  ok('the phase the line falls inside ends there', cut.phases[1].end_week === 6 && cut.duration_weeks === 6);
  ok('milestones past the line go with them', cut.milestones.map(m => m.id).join() === 'm1');
  ok('and the result is a plan the validators accept', validateProtocol(cut).length === 0, validateProtocol(cut)[0]);
  const exact = trimToWeeks(planOf(12), 8);
  ok('a line on a phase boundary keeps whole phases', exact.phases.map(ph => ph.id).join() === 'p1,p2'
    && exact.phases[1].end_week === 8 && validateProtocol(exact).length === 0);
  const tiny = trimToWeeks(planOf(12), 1);
  ok('even a one-week trim is a valid plan', tiny.duration_weeks === 1 && tiny.phases.length === 1
    && tiny.phases[0].end_week === 1 && validateProtocol(tiny).length === 0, validateProtocol(tiny)[0]);
}

/* ── the past is still frozen ─────────────────────────────────────────── */
{
  const stored = planOf(8);
  const revised = { ...planOf(16), goal_statement: 'rewritten' };
  const merged = spliceFrozenPast(stored, revised, 8);
  ok('an extension keeps the stored weeks and takes the new ones from the model',
    merged.phases.slice(0, 2).every((ph, i) => ph === stored.phases[i])
    && merged.duration_weeks === 16 && validateProtocol(merged).length === 0, validateProtocol(merged)[0]);
  ok('…including the milestones already earned', merged.milestones.some(m => m.id === 'm1'));
}

/* ── a retry is not a new graduation ──────────────────────────────────── */
{
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const at = index.indexOf('const graduateMatch');
  const route = index.slice(at, index.indexOf('const graduateMatch', at + 1) > 0 ? index.indexOf('const graduateMatch', at + 1) : at + 2500);
  const replay = route.indexOf('graduationReplay(');
  ok('the graduate route answers a replay BEFORE the AI switch and the quota',
    replay > 0 && replay < route.indexOf("env.AI_ENABLED !== 'true'") && replay < route.indexOf('checkQuota('));
  ok('…and the body is read once, not twice', (route.match(/request\.json\(\)/g) ?? []).length === 1);

  const client = readFileSync(new URL('../../src/api/goals.ts', import.meta.url), 'utf8');
  const fn = client.slice(client.indexOf('export async function graduateGoal('), client.indexOf('/* ── Adjust my plan'));
  ok('the app sends an id the CALLER holds, so a retry is the same graduation',
    /attemptId = mintId\(\)/.test(fn) && /protocolId: attemptId/.test(fn) && /newGoalId: attemptId/.test(fn));
  const screen = readFileSync(new URL('../../src/screens/GraduationScreen.tsx', import.meta.url), 'utf8');
  ok('…and the screen keeps it until the choice actually works',
    /attempts = useRef/.test(screen) && /attemptFor\(choice\)/.test(screen));
}

console.log(`\n${failures.length ? `GRADUATION CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `GRADUATION CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
