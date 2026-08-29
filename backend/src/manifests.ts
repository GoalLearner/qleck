// Required-inputs manifests: what the coach must KNOW before the generator
// may prescribe numbers (owner spec 2026-08-29). Each field carries the
// reason it exists — the reason is shown to the model so questions explain
// themselves, and to reviewers so the manifest stays honest.
//
// REQUIRED is deliberately small (3-5): every required field is one the
// protocol's numbers actually derive from. OPTIONAL fields sharpen the plan
// but never block generation. A required field still missing after the
// interview's hard cap (6 turns) degrades to an explicit assumption on the
// protocol step — never a silently invented number.

export type Domain =
  | 'strength' | 'endurance' | 'body_composition' | 'skill' | 'money'
  | 'career' | 'creative' | 'audience' | 'social' | 'habit_change' | 'academic' | 'other';

export interface ManifestField {
  key: string;
  required: boolean;
  reason: string;              // "bodyweight → protein target"
  quickPicks?: string[];       // obvious buckets, offered as chips
}

const F = (key: string, required: boolean, reason: string, quickPicks?: string[]): ManifestField =>
  ({ key, required, reason, ...(quickPicks ? { quickPicks } : {}) });

export const MANIFESTS: Record<Domain, ManifestField[]> = {
  strength: [
    F('current_best', true, 'current 1RM or best recent set on the target lift → sizes the gap and the loading plan'),
    F('bodyweight', true, 'bodyweight → protein and any nutrition target', ['Under 150 lbs / 68 kg', '150-180 lbs / 68-82 kg', '180-210 lbs / 82-95 kg', 'Over 210 lbs / 95 kg']),
    F('training_days_per_week', true, 'available training days → session count and split', ['2 days', '3 days', '4 days', '5+ days']),
    F('training_age', true, 'years lifting → realistic rate of strength gain', ['Under 1 year', '1-3 years', '3-5 years', '5+ years']),
    F('injuries_limits', false, 'injuries or limitations → exercise selection and loading guards'),
    F('equipment', false, 'equipment access → whether the plan assumes a barbell, dumbbells, or machines'),
  ],
  endurance: [
    F('current_pace_or_distance', true, 'current pace or longest comfortable distance → starting volume and target pacing'),
    F('days_per_week', true, 'run/train days available → weekly volume and recovery spacing', ['2 days', '3 days', '4 days', '5+ days']),
    F('training_history', true, 'how long consistently training → injury risk and ramp rate', ['Starting from zero', 'On and off', '6+ months consistent', 'Years of base']),
    F('injuries_limits', false, 'past injuries (shins, knees, ankles) → ramp guards and stop rules'),
    F('race_date', false, 'a fixed event date → the timeline is externally pinned'),
  ],
  body_composition: [
    F('bodyweight', true, 'current bodyweight → protein target, deficit/surplus size, weekly change rate', ['Under 150 lbs / 68 kg', '150-180 lbs / 68-82 kg', '180-210 lbs / 82-95 kg', 'Over 210 lbs / 95 kg']),
    F('training_days_per_week', true, 'training days available → resistance-training floor the cut/bulk needs', ['2 days', '3 days', '4 days', '5+ days']),
    F('eating_pattern', true, 'how eating works today (cooking, takeout, skipped meals) → which lever the calorie change pulls'),
    F('past_attempts', true, 'past diets/bulks and how they ended → guardrails against the known failure mode'),
    F('activity_level', false, 'daily movement baseline → whether a step floor is additive or already there'),
  ],
  skill: [
    F('current_level', true, 'current level → where practice starts', ['Complete beginner', 'Some basics', 'Intermediate', 'Advanced']),
    F('hours_per_week', true, 'practice hours available → session length and pace of progression', ['Under 2 h', '2-4 h', '4-7 h', '7+ h']),
    F('prior_attempts', true, 'prior attempts and how they died → what the plan must do differently'),
    F('practice_context', false, 'where/with what practice happens (apps, tutor, alone) → drill selection'),
    F('deadline', false, 'a fixed date the skill is needed by → timeline is externally pinned'),
  ],
  money: [
    F('current_amount', true, 'current saved amount → the true remaining gap'),
    F('income_or_contribution_capacity', true, 'income or realistic monthly contribution → whether the target math closes'),
    F('pay_cadence', true, 'pay cadence → transfer schedule anchors to real paydays', ['Weekly', 'Biweekly', 'Twice a month', 'Monthly']),
    F('target_date', true, 'target date → required contribution per pay period'),
    F('fixed_obligations', false, 'rent/debt obligations → how much capacity is genuinely free'),
  ],
  career: [
    F('current_role_level', true, 'current role and level → the actual distance to the target'),
    F('promotion_criteria', true, 'what the next level requires where they work (or unknown) → the plan targets evidence, not vibes'),
    F('manager_alignment', true, 'whether the manager knows and supports the goal → the first move differs completely', ['Fully aligned', 'Mentioned once', 'Not yet raised', 'No manager']),
    F('timeline_expectation', false, 'review cycles / when promotions happen → pins milestones to real windows'),
    F('visible_gaps', false, 'known feedback or gaps → what the evidence plan must cover first'),
  ],
  creative: [
    F('current_output', true, 'current output rhythm (words, pages, songs, hours) → sizes the daily quota honestly'),
    F('hours_per_week', true, 'creative hours available → session structure', ['Under 3 h', '3-6 h', '6-10 h', '10+ h']),
    F('project_scope', true, 'target size (novel words, EP tracks, portfolio pieces) → total volume the timeline must cover'),
    F('prior_attempts', false, 'past unfinished projects and where they stalled → the guardrail the plan needs'),
    F('accountability', false, 'who sees the work in progress → whether shipping pressure exists'),
  ],
  audience: [
    F('platform', true, 'which platform → the growth playbook differs completely (TikTok pace vs newsletter pace)', ['TikTok', 'YouTube', 'Instagram', 'Newsletter/other']),
    F('current_followers', true, 'current follower/subscriber count → the true gap and honest growth-rate math'),
    F('current_avg_views', true, 'typical views/opens per post → reach per rep, which drives how many reps the target needs'),
    F('posting_cadence', true, 'current posting rhythm → the realistic ramp from today, not from zero', ['Rarely', '1-2 a week', '3-5 a week', 'Daily']),
    F('hours_per_week', true, 'production hours available → what cadence is sustainable', ['Under 3 h', '3-6 h', '6-10 h', '10+ h']),
    F('niche', false, 'content niche → format and hook advice'),
    F('best_performing_content', false, 'what has already worked → double down before experimenting'),
    F('prior_growth_attempts', false, 'past pushes and how they ended → the burnout guardrail the plan needs'),
  ],
  social: [
    F('current_frequency', true, 'how often they currently see people → the realistic starting cadence'),
    F('existing_circle', true, 'whether the people exist already or must be met → completely different plans', ['Friends I rarely see', 'A few acquaintances', 'Starting fresh somewhere new', 'Mix of both']),
    F('preferred_settings', true, 'what settings feel doable (small groups, 1:1, activities) → rep design that will actually happen'),
    F('schedule_windows', false, 'free evenings/weekends → when reps can be scheduled'),
  ],
  habit_change: [
    F('current_baseline', true, 'measured current frequency/amount (cigarettes/day, steps/day, hours scrolling) → taper or ramp math anchors here; if never counted, week one counts'),
    F('context', true, 'for BREAKING a habit: when and where it mostly fires; for STARTING one: the part of the day it attaches to → replacement or slot design'),
    F('past_attempts', true, 'past attempts at this change and how they ended → what the plan does differently'),
    F('support_context', false, 'who knows / who is around it daily → social cost and environment design'),
  ],
  academic: [
    F('current_standing', true, 'current grade/score/level → the real gap to the target'),
    F('hours_per_week', true, 'study hours available → session plan', ['Under 5 h', '5-10 h', '10-15 h', '15+ h']),
    F('exam_or_deadline_date', true, 'exam or submission date → the timeline is fixed, the plan compresses to it'),
    F('weak_areas', false, 'known weak topics → where deliberate practice concentrates'),
    F('materials', false, 'materials/resources in hand → whether acquiring them is week one'),
  ],
  other: [
    F('current_state', true, 'where they are today on this goal → the starting line'),
    F('capacity', true, 'time/resources realistically available per week → the plan budget'),
    F('past_attempts', true, 'what has been tried and how it went → what to do differently'),
  ],
};

export const DOMAINS = Object.keys(MANIFESTS) as Domain[];

export function isDomain(x: unknown): x is Domain {
  return typeof x === 'string' && (DOMAINS as string[]).includes(x);
}

/** Required keys of a domain still absent from the collected answers. */
export function missingRequired(domain: Domain, answers: Record<string, string>): ManifestField[] {
  return MANIFESTS[domain].filter(f => f.required && !(f.key in answers));
}

/** The manifest rendered for a prompt: keys, R/O, reasons, quick-picks. */
export function manifestForPrompt(domain: Domain): string {
  return MANIFESTS[domain]
    .map(f => `- ${f.key} [${f.required ? 'REQUIRED' : 'optional'}]: ${f.reason}${f.quickPicks ? ` (quick-picks: ${f.quickPicks.join(' | ')})` : ''}`)
    .join('\n');
}
