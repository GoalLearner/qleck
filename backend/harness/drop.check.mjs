// Ticking reps off a plan, checked WITHOUT a model.
//
//   node harness/drop.check.mjs
//
// The drop picker refused anything that cost a physique pillar — on a weight
// goal that is most of phase 1, so "I can't do this one" was answered with
// "no". Ticks let them, and say what it cost. These bars hold the two halves
// of that promise: nothing is refused but an empty plan, and the cost line
// and the odds ceiling are computed from stored facts rather than written by
// a model. The last bar is the load-bearing one — over every plan the last
// harness run produced, no random set of unticked reps can produce a plan the
// validators reject.
import { readFileSync } from 'node:fs';
import { untickPlan, costLine, dropOddsBounds, retireSteps, restoreRetired, stepActiveInWeek, withoutRetired } from '../src/dropPlan.ts';
import { validateProtocol, sessionErrors } from '../src/protocolSchema.ts';

let pass = 0;
let skipped = false;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const step = (id, extra = {}) => ({ id, title: id, kind: 'binary', frequency: { per_week: 3 }, details: 'do it', ...extra });
const plan = (...phases) => ({
  schema_version: 1, goal_statement: 'g', duration_weeks: 12, coach_notes: '',
  phases: phases.map((steps, i) => ({
    id: `p${i + 1}`, title: `Phase ${i + 1}`, focus: 'f',
    start_week: i * 4 + 1, end_week: i * 4 + 4, steps,
  })),
  milestones: [{ id: 'm1', week: 4, title: 'four', criteria: 'c' }],
});

console.log('\nticking reps off a plan\n');

/* ── untickPlan ───────────────────────────────────────────────────────── */
{
  const p = plan([step('a'), step('b')], [step('c')], [step('d')]);
  const frozen = JSON.stringify(p);
  const out = untickPlan(p, ['b']);
  ok('the unticked rep is out and everything else stays', out.plan.phases[0].steps.map(s => s.id).join() === 'a'
    && out.plan.phases.length === 3);
  ok('untickPlan never touches the plan it was given', JSON.stringify(p) === frozen);
  ok('it reports the ids it actually matched', out.ids.join() === 'b' && untickPlan(p, ['b', 'nope']).ids.join() === 'b');
  ok('nothing unticked is not a refusal', untickPlan(p, []).ids.length === 0 && !('error' in untickPlan(p, [])));

  const folded = untickPlan(p, ['c']);
  ok('an emptied phase folds into the phase before it', folded.plan.phases.map(ph => ph.id).join() === 'p1,p3'
    && folded.plan.phases[0].end_week === 8);
  ok('the fold is reported with its weeks and where they went',
    folded.folded.length === 1 && folded.folded[0].title === 'Phase 2'
    && folded.folded[0].start_week === 5 && folded.folded[0].end_week === 8 && folded.folded[0].into === 'before');
  ok('the plan keeps its length and its milestones', folded.plan.duration_weeks === 12
    && folded.plan.milestones.length === 1 && folded.plan.milestones[0].week === 4);

  const leading = untickPlan(p, ['a', 'b']);
  ok('a leading empty phase gives its weeks to the phase after it',
    leading.plan.phases.map(ph => ph.id).join() === 'p2,p3' && leading.plan.phases[0].start_week === 1
    && leading.folded[0].into === 'after');
  const two = untickPlan(plan([step('a')], [step('b')], [step('c')], [step('d')]), ['b', 'c']);
  ok('two adjacent empty phases fold together', two.plan.phases.map(ph => ph.id).join() === 'p1,p4'
    && two.plan.phases[0].end_week === 12 && two.folded.length === 2);
  const trailing = untickPlan(p, ['d']);
  ok('a trailing empty phase folds back into the one before it',
    trailing.plan.phases.map(ph => ph.id).join() === 'p1,p2' && trailing.plan.phases[1].end_week === 12);
  ok('the only refusal is a plan with nothing left', untickPlan(p, ['a', 'b', 'c', 'd']).error === 'empty_plan');
  ok('…and one surviving rep is still a plan', untickPlan(p, ['a', 'b', 'c']).plan.phases.length === 1);
}

/* ── costLine ─────────────────────────────────────────────────────────── */
{
  const pillar = n => `physique goal: phase 1 is missing the ${n} pillar`;
  ok('one lost pillar is named and counted',
    costLine({ pillars: [pillar('protein (ideally grams from reported bodyweight)')] })
      === 'Protein is out — one of the five pillars a physique plan stands on.');
  ok('two lost pillars read as a sentence',
    costLine({ pillars: [pillar('protein (grams)'), pillar('sleep (a checkable bedtime step)')] })
      === 'Protein and sleep are out — two of the five pillars a physique plan stands on.');
  ok('three read as a list',
    costLine({ pillars: [pillar('training (a gym step)'), pillar('protein (grams)'), pillar('sleep (bedtime)')] })
      === 'Training, protein and sleep are out — three of the five pillars a physique plan stands on.');
  ok('the step-count pillar error contributes no junk name',
    costLine({ pillars: ['physique goal: phase 1 has 3 steps but needs at least 5, one per pillar (training, …)'] }) === null);
  ok('a lost pillar outranks a fold',
    /pillars a physique plan/.test(costLine({
      pillars: [pillar('sleep (bedtime)')],
      folded: [{ title: 'Base', start_week: 5, end_week: 8, into: 'before' }],
    })));
  ok('a fold says which weeks moved and where',
    costLine({ folded: [{ title: 'Base', start_week: 5, end_week: 8, into: 'before' }] })
      === '“Base” has nothing left in it. Weeks 5–8 join the phase before it.');
  ok('a one-week fold says week, not weeks',
    costLine({ folded: [{ title: 'Taper', start_week: 12, end_week: 12, into: 'after' }] })
      === '“Taper” has nothing left in it. Week 12 join the phase after it.');
  ok("an own-plan rep Qoach added carries Qoach's own reason",
    costLine({ qoach: [{ title: 'Deload week', details: 'Added because eight hard weeks with no deload is how people get hurt. Do half the sets.' }] })
      === '“Deload week” was Qoach\'s own addition — added because eight hard weeks with no deload is how people get hurt.');
  ok('…and without a reason it still says whose it was',
    costLine({ qoach: [{ title: 'Deload week' }] }) === '“Deload week” was Qoach\'s own addition to your plan.');
  ok('nothing worth saying is null', costLine({}) === null && costLine({ pillars: [], folded: [], qoach: [] }) === null);
}

/* ── dropOddsBounds ───────────────────────────────────────────────────── */
{
  ok('with no price yet, the plan as designed is the ceiling', dropOddsBounds(82, null, ['a']) === 82);
  ok('dropping MORE on top of a priced drop cannot beat that price',
    dropOddsBounds(82, { odds: 61, ids: ['a'] }, ['a', 'b']) === 61);
  ok('ticking one back on goes back to the plan’s own ceiling',
    dropOddsBounds(82, { odds: 61, ids: ['a', 'b'] }, ['a']) === 82);
  ok('a different set is priced against the ceiling, not the last number',
    dropOddsBounds(82, { odds: 61, ids: ['a'] }, ['b']) === 82);
  ok('the same set again is held to the same number', dropOddsBounds(82, { odds: 61, ids: ['a'] }, ['a']) === 61);
  ok('a missing ceiling falls back to the schema maximum', dropOddsBounds(null, null, ['a']) === 97
    && dropOddsBounds(undefined, { odds: null, ids: [] }, ['a']) === 97);
  ok('the bound is never below 1', dropOddsBounds(0, { odds: 0, ids: [] }, ['a']) === 1);
}

/* ── the safety net, over real plans ──────────────────────────────────── */
{
  let plans = [];
  try { plans = JSON.parse(readFileSync(new URL('./last-protocols.json', import.meta.url), 'utf8')); } catch { /* none yet */ }
  // The corpus is the last paid harness run's own output and is not in the
  // repo, so a fresh clone has none. Say so rather than failing: this section
  // is a proof over real plans, and with no real plans there is nothing to
  // prove either way.
  if (!plans.length) {
    console.log('  SKIP  no harness/last-protocols.json — run `npm run harness` to check ticks against real plans');
    skipped = true;
  }

  // Deterministic PRNG: the same 300 sets every run, so a failure is a fact.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let runs = 0, broke = null, mutated = null, lostWeeks = null, wrongRefusal = null, emptyRefusals = 0, dirty = 0;
  for (const entry of plans) {
    const p = entry.protocol;
    if (!p?.phases?.length) continue;
    // What the stored plan already complains about. A tick answers for what
    // IT breaks — two of the harness's own plans arrive carrying a rep on
    // days its session does not have (the revision path rewrites later
    // phases and validates the schema only), and that is not a tick's fault.
    const known = new Set([...validateProtocol(p), ...sessionErrors(p)]);
    if (known.size) dirty++;
    const ids = p.phases.flatMap(ph => ph.steps.map(s => s.id));
    const span = [Math.min(...p.phases.map(ph => ph.start_week)), Math.max(...p.phases.map(ph => ph.end_week))];
    for (let i = 0; i < 300; i++) {
      const pick = ids.filter(() => rnd() < (i % 10) / 9);
      const before = JSON.stringify(p);
      const out = untickPlan(p, pick);
      runs++;
      if (JSON.stringify(p) !== before) { mutated = entry.id; break; }
      if ('error' in out) {
        emptyRefusals++;
        // The ONLY legal refusal: every rep in the plan was unticked.
        if (pick.length !== ids.length) wrongRefusal = `${entry.id}: refused ${pick.length}/${ids.length}`;
        continue;
      }
      const errs = [...validateProtocol(out.plan), ...sessionErrors(out.plan)].filter(e => !known.has(e));
      if (errs.length) { broke = `${entry.id}: ${errs[0]} (dropped ${pick.length})`; break; }
      const kept = out.plan.phases;
      const covered = Math.min(...kept.map(ph => ph.start_week)) === span[0]
        && Math.max(...kept.map(ph => ph.end_week)) === span[1]
        && kept.every((ph, j) => j === 0 || ph.start_week === kept[j - 1].end_week + 1)
        && out.plan.duration_weeks === p.duration_weeks;
      if (!covered) { lostWeeks = `${entry.id}: ${kept.map(ph => `${ph.start_week}-${ph.end_week}`).join(' ')}`; break; }
    }
    if (broke || mutated || lostWeeks) break;
  }
  if (!skipped) {
    ok(`${runs} random tick sets over ${plans.length} real plans add no validator complaint of their own`, !broke, broke ?? '');
    ok(`…and the check is differential, so a plan that arrives dirty is not blamed on a tick (${dirty} of ${plans.length} do)`, true);
    ok('…never mutate the stored plan', !mutated, mutated ?? '');
    ok('…never lose or overlap a week, and never change the duration', !lostWeeks, lostWeeks ?? '');
    ok(`…and refuse only when every rep is off (${emptyRefusals} empty sets)`, !wrongRefusal, wrongRefusal ?? '');
  }
}

/* ── "Not for me", after the plan is running ──────────────────────────── */
{
  const live = () => plan(
    [step('a'), step('b')],          // weeks 1-4
    [step('c'), step('d')],          // weeks 5-8  (being lived in week 6)
    [step('e'), step('f')],          // weeks 9-12
  );
  const p = live();
  const frozen = JSON.stringify(p);
  const out = retireSteps(p, ['c'], 6);
  ok('retireSteps never touches the plan it was given', JSON.stringify(p) === frozen);
  ok('the past is returned byte-identical', JSON.stringify(out.plan.phases[0]) === JSON.stringify(p.phases[0]));
  ok('in the phase being lived the rep STAYS, marked from this week',
    out.plan.phases[1].steps.map(s => s.id).join() === 'c,d'
    && out.plan.phases[1].steps[0].retired_from_week === 6
    && out.retired.join() === 'c');
  ok('a retired rep is off from that week and on before it',
    !stepActiveInWeek(out.plan.phases[1].steps[0], 6) && !stepActiveInWeek(out.plan.phases[1].steps[0], 7)
    && stepActiveInWeek(out.plan.phases[1].steps[0], 5) && stepActiveInWeek(out.plan.phases[1].steps[1], 9));

  const later = retireSteps(live(), ['c', 'e'], 6);
  ok('in phases that have not started it is simply gone',
    later.plan.phases[2].steps.map(s => s.id).join() === 'f' && later.removed.join() === 'e');
  const folds = retireSteps(live(), ['e', 'f'], 6);
  ok('a future phase left empty folds into the one before it, and the plan keeps its length',
    folds.plan.phases.length === 2 && folds.plan.phases[1].end_week === 12
    && folds.plan.duration_weeks === 12 && folds.folded.length === 1);

  ok('taking out everything that is left is refused', retireSteps(live(), ['c', 'd', 'e', 'f'], 6).error === 'nothing_left');
  ok('…but emptying the CURRENT phase is allowed while something is on later',
    retireSteps(live(), ['c', 'd'], 6).retired.join() === 'c,d');
  ok('a rep that is not in the plan from here on is nothing to retire',
    retireSteps(live(), ['a'], 6).error === 'nothing_retired' && retireSteps(live(), [], 6).error === 'nothing_retired');
  ok('retiring the same rep twice changes nothing',
    retireSteps(retireSteps(live(), ['c'], 6).plan, ['c'], 7).error === 'nothing_retired');

  /* what Qoach is shown, and what comes back */
  const retiredPlan = retireSteps(live(), ['c'], 6).plan;
  const shown = withoutRetired(retiredPlan);
  ok('a retired rep is never shown to the model', !shown.phases.flatMap(ph => ph.steps).some(s => s.id === 'c'));
  ok('…and the weeks it is shown still tile the plan end to end',
    shown.phases.every((ph, i) => (i === 0 ? ph.start_week === 1 : ph.start_week === shown.phases[i - 1].end_week + 1))
    && shown.phases[shown.phases.length - 1].end_week === 12);
  const revised = { ...shown, phases: shown.phases.map(ph => ({ ...ph, steps: ph.steps.map(s => ({ ...s, title: `${s.title} (revised)` })) })) };
  const back = restoreRetired(revised, retiredPlan);
  const restored = back.phases.flatMap(ph => ph.steps).find(s => s.id === 'c');
  ok('a revision puts the retired rep back where it was', !!restored && restored.retired_from_week === 6
    && back.phases[1].steps.some(s => s.id === 'c'));
  ok('…untouched by the revision (its title is the one the user retired)', restored.title === 'c');
  ok('a revision that kept the rep is not given a second copy',
    restoreRetired(retiredPlan, retiredPlan).phases.flatMap(ph => ph.steps).filter(s => s.id === 'c').length === 1);
  ok('nothing retired, nothing to restore', restoreRetired(live(), live()).phases.length === 3);
}

/* ── the source: what the server does with all this ───────────────────── */
{
  const coach = readFileSync(new URL('../src/coach.ts', import.meta.url), 'utf8');
  const ticks = coach.slice(coach.indexOf('export async function repriceTicks('), coach.indexOf('/** Initialize the simulation state'));
  ok('repriceTicks leaves the stored protocol whole', ticks.length > 0 && !/SET protocol =/.test(ticks));
  ok('…records the set the price describes', /SET plan_odds = \?, drop_ids = \?/.test(ticks));
  ok('…clamps against the plan as built, not the verdict', /dropOddsBounds\(ceiling, \{ odds: session\.plan_odds/.test(ticks)
    && /odds_ceiling/.test(ticks));
  ok('…prices the plan as designed without a model call when nothing is off',
    ticks.indexOf('if (!out.ids.length)') > 0 && ticks.indexOf('if (!out.ids.length)') < ticks.indexOf('callModel('));
  ok('…keeps the structural validators as a net, not a gate',
    /validateProtocol\(out\.plan\), \.\.\.sessionErrors\(out\.plan\)\]\.find\(e => !before\.has\(e\)\)/.test(ticks));
  ok('…and blames a tick only for what it broke', /const before = new Set\(\[\.\.\.validateProtocol\(full\), \.\.\.sessionErrors\(full\)\]\)/.test(ticks));
  ok('…and the pillars feed the cost line instead of refusing the drop',
    ticks.indexOf('costLine({') > 0 && /pillars: physiquePillarErrors/.test(ticks));

  // The re-pricing message moves the odds of every plan it touches, so it
  // changes with a prompt version or not at all.
  const literal = (fn) => {
    const body = coach.slice(coach.indexOf(fn), coach.indexOf('\n}\n', coach.indexOf(fn)));
    const start = body.indexOf('`A plan was accepted for this goal');
    let out = '', depth = 0;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (c === '$' && body[i + 1] === '{') { depth++; i++; continue; }
      if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
      if (c === '`' && i > start) break;
      out += c;
    }
    return out.replace(/\s+/g, ' ');
  };
  ok('the re-pricing message is the drop picker’s, word for word',
    literal('export async function repriceTicks(') === literal('export async function repriceTrimmedProtocol('),
    literal('export async function repriceTicks(').slice(0, 60));

  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const route = index.slice(index.indexOf('const repriceMatch'), index.indexOf('const protoMatch'));
  ok('the reprice route takes the whole tick state when the app sends it', /unticked_step_ids/.test(route) && /repriceTicks\(/.test(route));
  ok('…and still answers the old commitment picker (builds ≤35)', /dropped_step_ids/.test(route) && /repriceTrimmedProtocol\(/.test(route));
}

console.log(`\n${failures.length ? `DROP CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `DROP CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
