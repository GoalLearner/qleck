/**
 * The 3-day test goal — a plan that ENDS in three days, so the whole finish
 * flow can be walked in an afternoon instead of six weeks.
 *
 * The owner's call (15 Sep): short plans are a TESTING tool, not a product
 * feature. A three-day goal offered to everyone would teach people to set
 * goals that cannot change anything; a three-day goal behind seven taps on
 * the version line lets a tester find out what the ending does before a real
 * user reaches it.
 *
 * Everything about its shape is chosen so the test is honest:
 *
 *  - **One week, started four days ago.** `started_on` is immutable
 *    everywhere in this app (pauses are spans, never an anchor shift), so
 *    back-dating at creation is the only way to stand near the end of a plan.
 *    Three days remain.
 *  - **Flexible reps only** (a weekly quota, no fixed days). A pinned rep
 *    would report the four back-dated days as missed and the tester would
 *    spend the test looking at a comeback banner about days they never had.
 *  - **No coach session and no odds.** Nothing here was priced by Qoach, so
 *    nothing pretends to be: the goal carries no number, which is also what
 *    makes it obvious in the list.
 *  - **Reps that can actually be done three times in three days**, so the
 *    milestone at the end of week one is reachable and the finish screen has
 *    something true to say.
 */
import type { Protocol } from '../api/coachTypes';

/** How the goal announces itself everywhere it appears. */
export const TEST_GOAL_TITLE = 'Test plan (3 days)';
export const TEST_GOAL_STATEMENT = 'Finish a three-day test plan, to see what the ending does.';
/** Days of the one-week plan already spent when it is created. */
export const TEST_GOAL_BACKDATE = 4;

/** A goal is the test goal when its plan says so — no flag on the server. */
export function isTestGoal(goal: { statement?: string; protocol?: { short_title?: string } }): boolean {
  return goal.protocol?.short_title === TEST_GOAL_TITLE || goal.statement === TEST_GOAL_STATEMENT;
}

/** `local` minus `days`, in the app's own YYYY-MM-DD. */
export function backdate(local: string, days: number): string {
  const d = new Date(`${local}T12:00:00`);
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function testProtocol(): Protocol {
  return {
    schema_version: 1,
    goal_statement: TEST_GOAL_STATEMENT,
    short_title: TEST_GOAL_TITLE,
    duration_weeks: 1,
    phases: [{
      id: 'ph1',
      title: 'The whole plan',
      focus: 'Three days, three reps, then the ending.',
      start_week: 1,
      end_week: 1,
      steps: [
        {
          id: 'ph1-s1',
          title: 'Ten minutes of anything',
          kind: 'duration',
          frequency: { per_week: 3 },
          duration_minutes: 10,
          details: 'Walk, stretch, tidy one surface. The point is the tap, not the ten minutes.',
          derived_from: ['standard_practice'],
          how_to: {
            gist: 'Ten minutes, three times this week.',
            why: 'This plan exists to be finished, so the rep has to be finishable.',
            sections: [{ heading: 'What counts', body: 'Anything you would have done anyway, for ten minutes, on purpose.' }],
            counts_as_done: 'Ten minutes, once, marked here.',
          },
        },
        {
          id: 'ph1-s2',
          title: 'Write one line about the day',
          kind: 'binary',
          frequency: { per_week: 2 },
          details: 'One sentence, anywhere. Testing that a second rep shows up beside the first.',
          how_to: {
            gist: 'One sentence about the day, twice this week.',
            why: 'A second rep makes the day list, the ledger grid and the odds line real.',
            sections: [{ heading: 'What counts', body: 'One sentence. Nobody reads it.' }],
            counts_as_done: 'A line written, marked here.',
          },
        },
      ],
    }],
    milestones: [{
      id: 'm1',
      week: 1,
      title: 'The plan ran its course',
      criteria: 'Three days lived and the reps marked.',
      derived_from: ['standard_practice'],
    }],
    coach_notes: 'This plan is a test fixture, not coaching. It ends in three days so you can see what happens when a plan ends.',
  };
}

/** Everything the normal lock path needs, so nothing about this goal takes a
 *  special route through the app or the server. */
export function testGoalPlan(today: string): {
  goalText: string; statement: string; durationWeeks: number; protocol: Protocol; startedOn: string;
} {
  return {
    goalText: TEST_GOAL_STATEMENT,
    statement: TEST_GOAL_STATEMENT,
    durationWeeks: 1,
    protocol: testProtocol(),
    startedOn: backdate(today, TEST_GOAL_BACKDATE),
  };
}
