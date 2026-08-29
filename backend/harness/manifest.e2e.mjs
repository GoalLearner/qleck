// P2a verify: the 9 owner-specified goals end to end through the
// requirements-driven interview. For each goal: domain, structured answers,
// required fields still missing at generation, validator outcome, and every
// numeric target with its derived_from / assumption.
//
//   node harness/manifest.e2e.mjs            all 9
//   node harness/manifest.e2e.mjs bench      just goals whose id matches
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'http://127.0.0.1:8787';
let secret = null;
try {
  const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars'), 'utf8');
  const m = vars.match(/^HARNESS_SECRET=(.+)$/m);
  if (m) secret = m[1].trim();
} catch { /* fine */ }

// Answers route by question content, first-match-wins, each used once then
// falling back to reuse — mirrors genproto.mjs but with per-goal routes so
// manifest questions (bodyweight, pay cadence, current amount…) land.
const GOALS = [
  {
    id: 'bench-315',
    goal: 'Bench 315 lbs in 12 weeks',
    routes: [
      [/1rm|one[- ]rep|working (set|weight)|bench.*(now|max|current|best)|current.*bench/i, 'Current 1RM is 275 lbs'],
      [/weigh|body\s*weight|how heavy/i, 'I weigh 205 lbs'],
      [/days|often|sessions|schedule|week/i, '4 days a week, evenings'],
      [/how long|years|lifting|training (age|history)|experience/i, 'Lifting seriously for 4 years'],
      [/injur|limit|pain|equipment/i, 'No injuries, full barbell gym'],
      [/derail|stall|past|before|attempts?/i, 'Stalled at 285 last year and lost steam'],
    ],
  },
  {
    id: 'save-10k',
    goal: 'Save $10k by June',
    routes: [
      [/currently saved|saved (so far|now|already)|current (amount|savings)|how much.*(saved|have)/i, 'About $2,500 saved right now'],
      [/income|contribut|afford|set aside|per (month|paycheck)|capacity/i, 'I can realistically put away $900 a month'],
      [/paid|pay (cadence|cycle|schedule)|how often.*paid|paycheck/i, 'Paid biweekly'],
      [/date|deadline|by june|when/i, 'June 1st, hard date'],
      [/rent|obligation|debt|fixed/i, 'Rent $1,400, no debt'],
    ],
  },
  {
    id: 'sub20-5k',
    goal: 'Run a sub-20 5k',
    routes: [
      [/current (pace|5k|time|pr)|fastest|best.*5k|how fast|distance.*comfortab/i, 'Current 5k PR is 22:40'],
      [/days|often|per week|schedule/i, 'Can run 4 days a week'],
      [/how long|consistent|history|base|running for/i, 'Running consistently about 2 years'],
      [/injur|shin|knee|limit/i, 'No injuries'],
      [/race|event|date/i, 'No race booked yet'],
    ],
  },
  {
    id: 'spanish',
    goal: 'Learn conversational Spanish in 6 months',
    routes: [
      [/current (level|spanish)|know (any|some)|beginner|how much spanish/i, 'Complete beginner, a few words'],
      [/hours|time.*week|how much time|capacity/i, 'About 5 hours a week'],
      [/tried|attempts?|before|past/i, 'Did Duolingo for 2 months once, drifted off'],
      [/app|tutor|class|practice (with|context)|resources/i, 'Apps plus maybe an online tutor'],
      [/deadline|date|trip|by when/i, 'Visiting Mexico City in March'],
    ],
  },
  {
    id: 'novel',
    goal: 'Write a novel',
    routes: [
      [/currently writ|output|words.*(day|week)|rhythm|how (much|often).*writ/i, 'Maybe 500 words on a good weekend, most weeks nothing'],
      [/hours|time.*week|capacity|schedule/i, 'Evenings after 8pm, about 6 hours a week total'],
      [/scope|length|how long|word count|genre|what kind/i, 'Sci-fi, aiming for around 80,000 words'],
      [/tried|attempts?|before|stall|unfinished/i, 'Two abandoned drafts, both died around chapter 4'],
      [/accountab|share|reader|show/i, 'Nobody reads my drafts yet'],
    ],
  },
  {
    id: 'promotion',
    goal: 'Get promoted to senior',
    routes: [
      [/current (role|level|title)|what.*role|position/i, 'Mid-level product designer, 3 years in role'],
      [/criteria|requir|expectations|rubric|what does senior/i, 'There is a ladder doc; senior needs cross-team impact and mentoring'],
      [/manager|boss|raised|aligned|conversation/i, 'Mentioned it once in a 1:1, no concrete plan agreed'],
      [/review|cycle|timeline|when.*promot/i, 'Promotions happen at half-year reviews, next one in ~5 months'],
      [/gap|feedback|weak/i, 'Feedback says my visibility outside the team is low'],
    ],
  },
  {
    id: 'stop-vaping',
    goal: 'Stop vaping',
    routes: [
      [/how (much|many|often)|baseline|per day|current(ly)? (vap|use)|count/i, 'A pod lasts me about 2 days, hitting it all day'],
      [/when|where|trigger|fires|situations|moments/i, 'Worst while gaming at night and on work breaks'],
      [/tried|quit before|attempts?|past/i, 'Quit cold turkey once, lasted 5 days'],
      [/support|around|know|friends|partner/i, 'Girlfriend wants me to quit, roommate also vapes'],
    ],
  },
  {
    id: 'tiktok-10k',
    goal: 'Get 10k TikTok followers',
    routes: [
      [/views|opens|reach|perform/i, 'Videos average about 400 views'],
      [/followers|current(ly)?|where.*account|standing/i, 'At 800 followers right now'],
      [/cadence|how often.*post|posting|rhythm/i, 'Posting about twice a week'],
      [/hours|time|capacity|per week/i, 'Can put in 8 hours a week'],
      [/platform|where.*post|which app/i, 'TikTok only'],
      [/niche|content|what kind|videos/i, 'Cooking videos, 60-second recipes'],
      [/tried|before|attempts?|stall|burn/i, 'Posted daily for 3 weeks in January, burned out'],
    ],
  },
  {
    id: 'hostile-refusal',
    goal: 'Add 50 lbs to my squat',
    hostile: true,
    routes: [
      [/squat.*(now|max|current|best)|current.*squat|1rm|one[- ]rep|working/i, 'Squat is at 225 lbs for a heavy single'],
      [/weigh|body\s*weight|how heavy/i, "I'd rather not say my weight, skip that"],
      [/how long|years|training (age|history)|experience|lifting/i, "Can't remember, whatever, does it matter?"],
      [/days|often|sessions|schedule|week/i, 'I can squat 3 days a week'],
      [/injur|pain|limit/i, 'Left knee clicks on deep squats sometimes'],
      [/equipment|gym|rack/i, 'Full power rack at my gym'],
      [/derail|stall|past|before/i, 'Never really pushed squats before, bench guy'],
    ],
  },
  {
    id: 'be-happier',
    goal: 'be happier',
    routes: [
      [/concrete|specific|pin|which|direction|look like|mean for you/i, 'Honestly it is that I never see my friends anymore — I want a real social life again'],
      [/current(ly)?|how often|frequency|last time/i, 'Maybe see a friend once a month right now'],
      [/circle|exist|who|people|friends already/i, 'I have friends here, we just stopped organizing anything'],
      [/setting|prefer|doable|comfortable|kind of/i, 'Small groups, dinners, pickup basketball'],
      [/window|evening|weekend|schedule|free/i, 'Free most weeknights after 7 and Sunday afternoons'],
    ],
  },
];

// One retry on network faults: the local worker occasionally drops
// connections under sustained load and the supervisor revives it in seconds.
async function post(dev, p, b) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(BASE + p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': dev, ...(secret ? { 'X-Qleck-Harness': secret } : {}) },
        body: JSON.stringify(b), signal: AbortSignal.timeout(240_000),
      });
      const j = await r.json();
      if (r.status >= 500 && attempt < 2) { await new Promise(res => setTimeout(res, 8000)); continue; }
      return { status: r.status, body: j };
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(res => setTimeout(res, 8000));
    }
  }
}

function answerFor(g, used, q) {
  for (let i = 0; i < g.routes.length; i++) {
    if (g.routes[i][0].test(q) && !used.has(i)) { used.add(i); return g.routes[i][1]; }
  }
  for (let i = 0; i < g.routes.length; i++) {
    if (g.routes[i][0].test(q)) return g.routes[i][1];
  }
  return 'Nothing unusual there — steady week to week.';
}

const filter = process.argv[2];
let failures = 0;
for (const g of GOALS) {
  if (filter && !filter.split(',').some(f => g.id.includes(f))) continue;
  const dev = crypto.randomUUID();
  const used = new Set();
  let res = await post(dev, '/coach/sessions', { goalText: g.goal });
  const id = res.body.sessionId;
  const qs = [];
  let n = 0;
  while (res.body.type === 'question' && n < 8) {
    n++;
    qs.push(res.body.question.question);
    res = await post(dev, `/coach/sessions/${id}/messages`, { answer: answerFor(g, used, res.body.question.question) });
  }
  console.log(`\n════ ${g.id} — "${g.goal}"`);
  if (res.body.type !== 'verdict') {
    console.log(`  FAIL: ended as ${res.body.type ?? res.status} after ${n} turns`);
    failures++;
    continue;
  }
  const v = res.body.verdict;
  console.log(`  domain: ${res.body.domain}   questions: ${n}   decision: ${v.decision}   odds: ${v.success_probability}%`);
  console.log(`  answers: ${JSON.stringify(res.body.answers)}`);
  console.log(`  factors: ${JSON.stringify(v.factors ?? null)}`);
  const proto = await post(dev, `/coach/sessions/${id}/protocol`, {});
  if (!proto.body.protocol) {
    console.log(`  FAIL: protocol ${proto.status}: ${JSON.stringify(proto.body).slice(0, 220)}`);
    failures++;
    continue;
  }
  const p = proto.body.protocol;
  let numerics = 0, cited = 0, assumed = 0, uncited = 0;
  for (const ph of p.phases) {
    for (const st of ph.steps) {
      const numeric = (st.quantity && st.quantity.amount > 0) || typeof st.duration_minutes === 'number';
      if (!numeric) continue;
      numerics++;
      const target = st.quantity ? `${st.quantity.amount} ${st.quantity.unit}` : `${st.duration_minutes} min`;
      if (st.assumption) { assumed++; console.log(`    ~ ${target.padEnd(14)} "${st.title.slice(0, 44)}" ASSUMED: ${st.assumption}${st.derived_from?.length ? ` (+ ${st.derived_from.join(', ')})` : ''}`); }
      else if (st.derived_from?.length) { cited++; console.log(`    ✓ ${target.padEnd(14)} "${st.title.slice(0, 44)}" ← ${st.derived_from.join(', ')}`); }
      else { uncited++; console.log(`    ✗ ${target.padEnd(14)} "${st.title.slice(0, 44)}" NO PROVENANCE`); }
    }
  }
  console.log(`  validator: PASSED (saved). numerics ${numerics}: ${cited} cited, ${assumed} assumed, ${uncited} uncited`);
  if (uncited > 0) failures++;

  if (g.hostile) {
    // The owner's hostile contract: interview stops at/before the hard cap,
    // generation still runs, assumptions appear ONLY on exhausted keys, and
    // the response exposes them in a correctable shape.
    const asm = proto.body.assumptions ?? [];
    const keys = proto.body.correctable_keys ?? [];
    const okTurns = n <= 6;
    console.log(`  hostile questions asked:`);
    qs.forEach((q, i) => console.log(`    ${i + 1}. ${q.slice(0, 110)}`));
    const okAssumed = assumed >= 1 && asm.length >= 1;
    const okKeys = keys.length >= 1;
    console.log(`  hostile: turns ${n} (<=6 ${okTurns}) | assumptions ${JSON.stringify(asm)} | correctable ${JSON.stringify(keys)}`);
    if (!okTurns || !okAssumed || !okKeys) { failures++; console.log('  hostile FAIL'); }
    else {
      // "Tap to correct": supply bodyweight, regenerate, the assumption dies.
      const fix = await post(dev, `/coach/sessions/${id}/answers`, { key: 'bodyweight', value: '200 lbs' });
      const re = await post(dev, `/coach/sessions/${id}/protocol`, {});
      const reAsm = (re.body.assumptions ?? []).filter(a => /weight/i.test(a.assumption));
      const cites = [];
      for (const ph of re.body.protocol?.phases ?? []) {
        for (const st of ph.steps ?? []) {
          if (st.derived_from?.includes('bodyweight')) cites.push(`${st.title.slice(0, 40)}`);
        }
      }
      const okFix = fix.body.ok && re.body.protocol && reAsm.length === 0;
      console.log(`  correction: answers ok=${fix.body.ok} regenerate=${fix.body.regenerate} | bodyweight-assumptions left: ${reAsm.length} | now cites bodyweight: ${JSON.stringify(cites)}`);
      if (!okFix) { failures++; console.log('  correction FAIL'); }
    }
  }
}
console.log(failures === 0 ? '\nALL GOALS CLEAN' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
