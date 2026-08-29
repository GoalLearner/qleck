// 2c: the scenario simulation (owner spec 2026-08-29, MiroFish single-person
// translation). Scenarios are CODE-DEFINED templates — resampling the model's
// opinion five times is not a simulation. Each run is one Flash call that
// walks the protocol week by week under the template's condition and returns
// a lane the verdict page can animate; the odds become a blend of the
// rubric's opinion and the measured pass rate.
import { callModel, modelsFor, type Env } from './ai';
import type { Protocol } from './protocolSchema';
import type { Domain } from './manifests';
import type { Verdict } from './coach';

/** Blend constant (owner spec): odds = BLEND×rubric + (1−BLEND)×pass_rate×100.
 *  Calibrated later against goal_outcomes — that table exists for this. */
export const BLEND = 0.5;
/** Parallelism cap for scenario calls (owner spec). */
export const SCENARIO_CONCURRENCY = 6;

export interface ScenarioWeek {
  week: number;
  /** Progress toward the goal in its own primary unit (lbs on the bar,
   *  dollars saved, followers, 5k seconds…). Monotonicity NOT required —
   *  disruptions dip. */
  state_value: number;
  /** 0-1 fraction of that week's reps actually done in this run. */
  adherence: number;
  /** Short narrative beat when something notable happened that week. */
  event?: string;
}

export interface ScenarioRun {
  key: string;
  name: string;
  hit: boolean;
  first_failure_key: string | null;
  first_failure_reason: string | null;
  weeks: ScenarioWeek[];
  /** Lane rejected by the validator after a retry — excluded from pass rate. */
  invalid?: boolean;
}

export interface SimulationState {
  status: 'generating' | 'simulating' | 'done' | 'failed';
  /** Which build this simulation belongs to. */
  config: { pace: string; variant: string | null };
  lanes: ScenarioRun[];
  planned: { key: string; name: string }[];
  odds?: { rubric: number; pass_rate: number; blended: number };
  factors?: { key: string; direction: 'up' | 'down'; weight: number }[];
  error?: string;
}

/** The domain's rate variable — what slow_response slows down. Defined per
 *  manifest domain (owner spec) so the template names a real mechanism, not
 *  a vibe. */
export const RATE_VARIABLE: Record<Domain, string> = {
  strength: 'strength gain rate (how fast weight is added to the bar)',
  endurance: 'aerobic adaptation rate (how fast pace/distance improves)',
  body_composition: 'rate of body-composition change (lbs/week responding to the deficit or surplus)',
  skill: 'acquisition rate (how fast practiced material sticks)',
  money: 'contribution capacity (how much each pay period can actually spare)',
  career: 'evidence accumulation rate (how fast promotion-worthy work lands and gets seen)',
  creative: 'output rate (words/pages/pieces produced per session)',
  audience: 'follower growth rate per post at current reach',
  social: 'rate new plans convert into actual meetups',
  habit_change: 'rate the new pattern replaces the old one',
  academic: 'retention rate (how much studied material holds by test day)',
  other: 'rate of progress toward the goal',
};

export interface ScenarioTemplate {
  key: string;
  name: string;
  domains?: Domain[];             // template applies only to these (absent = all)
  condition: (ctx: TemplateCtx) => string;
}

export interface TemplateCtx {
  domain: Domain;
  durationWeeks: number;
  answers: Record<string, string>;
}

/** Disruption window: 2 weeks lost around week 4-6, proportionally earlier
 *  for short horizons (owner spec). */
export function disruptionWindow(durationWeeks: number): { start: number; len: number } {
  const start = Math.max(2, Math.min(4, Math.round(durationWeeks * 0.3)));
  const len = durationWeeks >= 8 ? 2 : 1;
  return { start, len };
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    key: 'baseline',
    name: 'As planned',
    condition: () =>
      'The person shows up the way a motivated-but-human adult does: roughly 85% adherence, ordinary life friction, no unusual events. This is the honest expected case, not the fantasy case.',
  },
  {
    key: 'adherence_60',
    name: 'Rough patch',
    condition: () =>
      'Adherence runs at ~60% for the whole plan: skipped sessions most weeks, targets frequently missed, streaks repeatedly broken and restarted. Model what this level of showing up actually produces.',
  },
  {
    key: 'slow_response',
    name: 'Slow responder',
    condition: (ctx) =>
      `The person executes at planned adherence (~85%) but their ${RATE_VARIABLE[ctx.domain]} is 30% lower than the plan assumes. Effort is there; the response is not. Model where the trajectory lands.`,
  },
  {
    key: 'disruption',
    name: 'Life happens',
    condition: (ctx) => {
      const w = disruptionWindow(ctx.durationWeeks);
      return `Weeks ${w.start}-${w.start + w.len - 1} are LOST entirely (illness, travel, family emergency — zero reps, and the relevant baseline erodes slightly). Before and after, adherence is a normal ~85%. Model the recovery honestly: does the plan's remaining runway absorb the hole?`;
    },
  },
  {
    key: 'best_case',
    name: 'Locked in',
    condition: () =>
      'The person is locked in: 90% adherence, sleep protected, no major disruptions, and they respond to training/inputs at the expected rate. NOT a fantasy — 90%, not 100%, life still exists.',
  },
  {
    key: 'unexpected_expense',
    name: 'Surprise bill',
    domains: ['money'],
    condition: (ctx) => {
      const w = disruptionWindow(ctx.durationWeeks);
      return `An unexpected expense (car repair / medical bill, roughly one full contribution period's amount) lands at week ${w.start + 1}: that period's transfer is impossible and the next is halved. Adherence otherwise ~85%. Does the target date survive?`;
    },
  },
  {
    key: 'plateau',
    name: 'The stall',
    domains: ['strength'],
    condition: (ctx) =>
      `Progress stalls hard at roughly the 60% mark of the runway: the same weights stop moving for 3 weeks despite ~85% adherence (a classic plateau). Model whether the plan's progression rules break the stall in time, given ${ctx.durationWeeks} total weeks.`,
  },
  {
    key: 'algorithm_dip',
    name: 'Algorithm turns',
    domains: ['audience'],
    condition: (ctx) => {
      const w = disruptionWindow(ctx.durationWeeks);
      return `From week ${w.start} onward, reach per post drops to 40% of prior levels for 3 weeks (platform algorithm shift), then partially recovers to 75%. Posting adherence stays ~85%. Model follower trajectory through the dip.`;
    },
  },
];

export function templatesFor(domain: Domain): ScenarioTemplate[] {
  return SCENARIO_TEMPLATES.filter(t => !t.domains || t.domains.includes(domain));
}

const SCENARIO_TOOL = {
  name: 'report_run',
  description: 'Report the outcome of this single simulated run.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['hit', 'weeks'],
    properties: {
      hit: { type: 'boolean', description: 'Did this run reach the goal by the final week?' },
      first_failure_key: {
        type: 'string',
        description: "When hit=false: WHICH input broke the run first — one of the collected answer keys (e.g. 'training_days_per_week', 'income_or_contribution_capacity') or the scenario key itself when the imposed condition is the cause. Omit when hit=true.",
      },
      first_failure_reason: {
        type: 'string',
        description: 'When hit=false: one plain sentence on how the run died ("the two lost weeks put the taper past June 1st"). Omit when hit=true.',
      },
      weeks: {
        type: 'array',
        description: 'EXACTLY one entry per week of the protocol, week 1..N.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['week', 'state_value', 'adherence'],
          properties: {
            week: { type: 'number' },
            state_value: { type: 'number', description: "Progress in the goal's own primary unit (bar weight, dollars saved, followers, minutes…). Dips are allowed and expected under disruptions." },
            adherence: { type: 'number', description: '0-1 fraction of that week\'s reps done.' },
            event: { type: 'string', description: 'Short beat when something notable happened ("missed both sessions", "surprise bill hit").' },
          },
        },
      },
    },
  },
} as const;

export const SIM_SYSTEM = `You simulate ONE run of a specific person attempting a specific protocol, week by week, under an imposed condition. You are not coaching and not judging — you are running the tape forward honestly.

Rules:
- The protocol, the person's collected facts, and the condition are given. The condition OVERRIDES optimism: apply it mechanically.
- state_value tracks the goal's primary metric in its own unit, starting from the person's stated baseline. Progress rates must be physiologically/financially/practically honest for this domain — no heroic weeks.
- Momentum matters: missed weeks erode; recoveries take time; taper/deload/measurement mechanics in the protocol apply.
- hit=true ONLY if the final-week state genuinely reaches the goal's target. Near misses are misses.
- When hit=false, name the FIRST input that broke the run (first_failure_key): a collected answer key when the person's real-world constraint was the breaking point, or the scenario key when the imposed condition was. One plain sentence of reason.
- EXACTLY one weeks[] entry per protocol week. No summaries, no extra prose.`;

/** Validate a run per the owner's spec. Returns null when clean, else the
 *  errors (the caller retries once with them, then marks the lane invalid). */
export function validateRun(
  run: Partial<ScenarioRun>,
  horizon: number,
  answers: Record<string, string>,
  templateKey: string,
): string[] {
  const errs: string[] = [];
  if (typeof run.hit !== 'boolean') errs.push('hit must be boolean');
  const weeks = Array.isArray(run.weeks) ? run.weeks : [];
  if (weeks.length !== horizon) errs.push(`weeks has ${weeks.length} entries but the protocol runs ${horizon} weeks — exactly one entry per week`);
  weeks.forEach((w, i) => {
    if (typeof w?.state_value !== 'number' || !Number.isFinite(w.state_value)) errs.push(`weeks[${i}].state_value must be numeric`);
    if (typeof w?.adherence !== 'number' || w.adherence < 0 || w.adherence > 1) errs.push(`weeks[${i}].adherence must be 0-1`);
  });
  if (run.hit === false) {
    const key = run.first_failure_key;
    const legal = new Set([...Object.keys(answers), templateKey]);
    if (!key || !legal.has(key)) {
      errs.push(`first_failure_key "${key ?? ''}" must be a collected answer key (${Object.keys(answers).join(', ') || 'none'}) or the scenario key "${templateKey}"`);
    }
    if (!run.first_failure_reason?.trim()) errs.push('first_failure_reason required when hit=false');
  }
  return errs;
}

/** One scenario, one Flash call, one validation retry. Never throws. */
export async function runScenario(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  template: ScenarioTemplate,
  ctx: TemplateCtx,
  protocol: Protocol,
  goalStatement: string,
): Promise<ScenarioRun> {
  const base: ScenarioRun = {
    key: template.key, name: template.name, hit: false,
    first_failure_key: null, first_failure_reason: null, weeks: [], invalid: true,
  };
  const userMsg =
    `GOAL: ${goalStatement}\n\n` +
    `COLLECTED FACTS:\n${JSON.stringify(ctx.answers)}\n\n` +
    `PROTOCOL (${ctx.durationWeeks} weeks):\n${JSON.stringify({ sessions: protocol.sessions, phases: protocol.phases, milestones: protocol.milestones })}\n\n` +
    `CONDITION FOR THIS RUN — ${template.name}:\n${template.condition(ctx)}\n\n` +
    `Simulate all ${ctx.durationWeeks} weeks and report the run.`;
  let messages = [{ role: 'user' as const, content: userMsg }];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callModel(env, { ...meta, kind: 'simulate', ...(attempt > 0 ? { retryKind: 'validator' as const, attempt } : {}) }, {
        model: modelsFor(env).classifier,
        system: SIM_SYSTEM,
        messages,
        tools: [SCENARIO_TOOL],
        toolChoice: { type: 'tool', name: SCENARIO_TOOL.name },
        maxTokens: 4000,
        temperature: 0.3,
      });
      const run = result.toolInput as Partial<ScenarioRun> | null;
      const errs = run ? validateRun(run, ctx.durationWeeks, ctx.answers, template.key) : ['no tool output'];
      if (run && errs.length === 0) {
        return {
          key: template.key, name: template.name,
          hit: run.hit as boolean,
          first_failure_key: run.hit ? null : (run.first_failure_key ?? null),
          first_failure_reason: run.hit ? null : (run.first_failure_reason ?? null),
          weeks: (run.weeks as ScenarioWeek[]).map(w => ({
            week: w.week, state_value: w.state_value,
            adherence: Math.max(0, Math.min(1, w.adherence)),
            ...(w.event ? { event: String(w.event).slice(0, 120) } : {}),
          })),
        };
      }
      messages = [
        { role: 'user' as const, content: userMsg },
        { role: 'user' as const, content: `[validator] Your previous run report was rejected:\n- ${errs.join('\n- ')}\nRe-report the SAME run corrected.` },
      ];
    } catch {
      // transport already backed off inside callModel; a second throw here
      // falls through to the invalid lane
    }
  }
  return base;
}

/** Blend + factors from a finished lane set (invalid lanes excluded). */
export function summarizeRuns(
  lanes: ScenarioRun[],
  rubricOdds: number,
): { odds: { rubric: number; pass_rate: number; blended: number }; factors: { key: string; direction: 'up' | 'down'; weight: number }[] } {
  const valid = lanes.filter(l => !l.invalid);
  const passRate = valid.length ? valid.filter(l => l.hit).length / valid.length : 0.5;
  const blended = Math.max(1, Math.min(97, Math.round(BLEND * rubricOdds + (1 - BLEND) * passRate * 100)));
  // Factors from first_failure_key counts (owner spec): what actually broke
  // runs, weighted by how often. All-pass runs credit the baseline inputs.
  const counts = new Map<string, number>();
  for (const l of valid) {
    if (!l.hit && l.first_failure_key) counts.set(l.first_failure_key, (counts.get(l.first_failure_key) ?? 0) + 1);
  }
  const factors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, n]) => ({ key, direction: 'down' as const, weight: Math.min(3, n) }));
  if (factors.length === 0 && valid.length > 0) {
    factors.push({ key: 'baseline', direction: 'up' as const, weight: 3 } as never);
  }
  return { odds: { rubric: Math.round(rubricOdds), pass_rate: Math.round(passRate * 100), blended }, factors };
}
