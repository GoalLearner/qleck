// The fabrication guard, checked WITHOUT the model.
//
//   node harness/fabrication.check.mjs
//
// fabricationErrors decides whether the plan is allowed to assert something
// about the user's life — an injury, a missed week, a relapse. Until now it
// was only ever exercised through the paid AI harness, which means the one
// rule protecting people from invented facts about themselves had no cheap
// test at all. It is pure logic; it should cost milliseconds, not 29 model
// calls.
//
// The bug these bars were written for: corroboration was a bare substring
// test, so "no injuries" contains "injur" and licensed the plan to discuss
// "your ankle injury". A denial was read as evidence.
import { fabricationErrors } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];

/** A protocol whose only prose is the line under test. */
const planSaying = text => ({
  schema_version: 1,
  goal_statement: 'Run a 5k',
  duration_weeks: 8,
  phases: [{
    id: 'p1', title: 'Build the base', focus: 'Get moving.', start_week: 1, end_week: 8,
    steps: [{
      id: 's1', title: 'Easy run', kind: 'duration', duration_minutes: 20,
      frequency: { per_week: 3 }, details: text,
    }],
  }],
  milestones: [],
  coach_notes: '',
});

function bar(name, { says, goal = 'Run a 5k in 8 weeks', answers = {}, flagged }) {
  const errs = fabricationErrors(planSaying(says), answers, goal);
  const got = errs.length > 0;
  if (got === flagged) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name}`);
  console.log(`        expected ${flagged ? 'a complaint' : 'silence'}, got ${got ? errs[0] : 'silence'}`);
}

console.log('\nfabrication guard\n');

/* ── a denial is not corroboration ──────────────────────────────────────── */
bar('"no injuries" does not license talking about your injury', {
  says: 'Ease back in and respect your ankle injury.',
  answers: { history: 'No injuries, and no fixed race booked.' },
  flagged: true,
});
bar('"never missed a week" does not license a missed week', {
  says: 'Getting back on track after your missed week.',
  answers: { history: 'I have never missed a week of training.' },
  flagged: true,
});
bar('"not sick" does not license an illness', {
  says: 'Rebuild gently after your illness.',
  answers: { health: 'I am not sick and I sleep fine.' },
  flagged: true,
});

/* ── a real report still corroborates ───────────────────────────────────── */
bar('a stated injury licenses discussing it', {
  says: 'Ease back in and respect your knee injury.',
  answers: { history: 'My knee has been sore since June.' },
  flagged: false,
});
bar('a stated lapse licenses getting back on track', {
  says: 'Getting back on track after your missed week.',
  answers: { history: 'I fell off for about three weeks in July.' },
  flagged: false,
});

/* ── the blunt strip must not eat the whole answer ──────────────────────── */
bar('negation stops at the clause boundary', {
  says: 'Respect your knee injury and keep the pace easy.',
  // The denial covers time, NOT the knee — the second clause is a real report.
  answers: { history: 'No time in the mornings, my knee still hurts on stairs.' },
  flagged: false,
});
bar('word boundaries hold — "know" is not "no"', {
  says: 'Respect your knee injury and keep the pace easy.',
  answers: { history: 'I know my knee gets sore when I run.' },
  flagged: false,
});

/* ── the ordinary case ──────────────────────────────────────────────────── */
bar('a plan that claims nothing is never flagged', {
  says: 'Twenty easy minutes at a conversational pace.',
  answers: { history: 'No injuries.' },
  flagged: false,
});
bar('the goal text itself can corroborate', {
  says: 'Work around your shoulder injury.',
  goal: 'Get back to pressing after a shoulder injury',
  answers: {},
  flagged: false,
});

console.log(`\n${failures.length ? `FABRICATION CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `FABRICATION CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
