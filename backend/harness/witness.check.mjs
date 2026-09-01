// P4.5 witness check (AI-free). The risk this phase carries is not a broken
// feature, it is a LEAK — an intimate goal exposed, or accountability turned
// into shame. So most of these bars are about what the page must NOT contain.
//
// Usage:  node harness/witness.check.mjs      (against http://127.0.0.1:8787)
const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const results = [];
const bar = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(path, { method = 'POST', body, token } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status < 500 || attempt >= 3) {
        const text = await res.text();
        let parsed = {};
        try { parsed = JSON.parse(text); } catch { /* html */ }
        return { status: res.status, body: parsed, text };
      }
    } catch (err) { if (attempt >= 3) throw err; }
    await sleep(1500 * 2 ** attempt);
  }
}

const localDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
};

// The confessional detail lives in goal_text — this string must never surface.
const SECRET_TEXT = 'I have relapsed four times and I am ashamed of it';

const reg = await api('/device/register', { body: { timezone: 'Europe/Oslo' } });
const token = reg.body.token;
const goalId = crypto.randomUUID();
const seed = await api('/goals', {
  token,
  body: {
    id: goalId, goalText: SECRET_TEXT, statement: 'Quit smoking in 8 weeks', durationWeeks: 8,
    startedOn: localDate(-3), timezone: 'Europe/Oslo',
    protocol: {
      schema_version: 1, goal_statement: 'Quit smoking in 8 weeks', short_title: 'Quit smoking in 8 weeks',
      duration_weeks: 8,
      phases: [{
        id: 'ph1', title: 'Taper', focus: 'x', start_week: 1, end_week: 8,
        steps: [{ id: 'ph1-s1', title: 'Log the count', kind: 'binary', frequency: { per_week: 7 }, details: 'd' }],
      }],
      milestones: [], coach_notes: 'n',
    },
  },
});
bar('seed a goal whose goal_text carries confessional detail', seed.status === 200 && !!seed.body.goal);

// Two banked days ending yesterday, so there is a streak and a quiet day.
for (const off of [-2, -1]) {
  await api('/check-ins', { token, body: { id: crypto.randomUUID(), goalId, stepId: 'ph1-s1', localDate: localDate(off) } });
}

/* ── sharing ────────────────────────────────────────────────────────────── */

const unshared = await api(`/w/${'0'.repeat(36)}`, { method: 'GET' });
bar('an unknown token 404s with a neutral page',
  unshared.status === 404 && /isn.t active/i.test(unshared.text) && !/streak/i.test(unshared.text));

const shared = await api(`/goals/${goalId}/share`, { token });
bar('share mints a token and a url',
  shared.status === 200 && /^[0-9a-f]{36}$/.test(shared.body.token ?? '') && !!shared.body.url,
  JSON.stringify(shared.body).slice(0, 120));
const shareToken = shared.body.token;

const again = await api(`/goals/${goalId}/share`, { token });
bar('sharing twice keeps the same link (a sent url stays valid)', again.body.token === shareToken);

const page = await api(`/w/${shareToken}`, { method: 'GET' });
bar('the shared page renders', page.status === 200 && /Quit smoking in 8 weeks/.test(page.text));

/* ── the privacy rules — the point of the phase ─────────────────────────── */

bar('the page NEVER contains the raw goal text', !page.text.includes(SECRET_TEXT),
  'confessional goal_text leaked to the witness');
bar('the page never names a miss, a failure or a skipped day',
  !/\bmissed?\b|\bfail(ed|ure)?\b|\bskip(ped)?\b|\bbroke\b/i.test(page.text));
bar('the page shows effort and a streak', /day streak/i.test(page.text) && /shown up/i.test(page.text));
bar('the page carries no goal id, user id or token in its body',
  !page.text.includes(goalId) && !page.text.includes(reg.body.userId) && !page.text.includes(shareToken));
bar('the page asks not to be indexed', /noindex/i.test(page.text));

// Per-goal, never per-account: a second goal on the same account stays dark.
const otherId = crypto.randomUUID();
await api('/goals', {
  token,
  body: {
    id: otherId, goalText: 'private second goal', statement: 'Save 5000 dollars', durationWeeks: 8,
    startedOn: localDate(-3), timezone: 'Europe/Oslo',
    protocol: {
      schema_version: 1, goal_statement: 'Save 5000 dollars', short_title: 'Save 5000 dollars', duration_weeks: 8,
      phases: [{ id: 'ph1', title: 'Stack', focus: 'x', start_week: 1, end_week: 8, steps: [{ id: 'ph1-s1', title: 'Move money', kind: 'binary', frequency: { per_week: 1, days: ['mon'] }, details: 'd' }] }],
      milestones: [], coach_notes: 'n',
    },
  },
});
const pageAfter = await api(`/w/${shareToken}`, { method: 'GET' });
bar('sharing ONE goal never exposes the account\'s other goals',
  !/Save 5000/i.test(pageAfter.text) && !pageAfter.text.includes(otherId));

/* ── a paused goal does not race ahead on the witness page ──────────────
   witness.ts carries its OWN copy of the pause arithmetic (the Worker cannot
   import the client's protocolTime), and duplicated maths is exactly what
   drifts unnoticed. Since started_on became immutable, forgetting to subtract
   paused days here would tell a witness the person is on week 4 of 4 — or
   mark the goal finished — while they are still working through week 2. */

const pausedId = crypto.randomUUID();
await api('/goals', {
  token,
  body: {
    id: pausedId, goalText: 'another private thing', statement: 'Walk every day', durationWeeks: 4,
    startedOn: localDate(-21), timezone: 'Europe/Oslo',
    protocol: {
      schema_version: 1, goal_statement: 'Walk every day', short_title: 'Walk every day', duration_weeks: 4,
      phases: [{ id: 'ph1', title: 'Walk', focus: 'x', start_week: 1, end_week: 4, steps: [{ id: 'ph1-s1', title: 'Walk', kind: 'binary', frequency: { per_week: 7 }, details: 'd' }] }],
      milestones: [], coach_notes: 'n',
    },
  },
});
const pausedShare = await api(`/goals/${pausedId}/share`, { token });
const beforePause = await api(`/w/${pausedShare.body.token}`, { method: 'GET' });
bar('21 days in, an unpaused goal reads week 4', /Week 4 of 4/.test(beforePause.text),
  (beforePause.text.match(/Week \d+ of \d+/) ?? ['no week line'])[0]);

// Paused for 14 of those 21 days: 7 plan days elapsed, so week 2.
await api(`/goals/${pausedId}/pause`, { token, body: { localDate: localDate(-14) } });
await api(`/goals/${pausedId}/resume`, { token, body: { localDate: localDate(0) } });
const afterPause = await api(`/w/${pausedShare.body.token}`, { method: 'GET' });
bar('a 14-day pause holds the witness page at week 2', /Week 2 of 4/.test(afterPause.text),
  (afterPause.text.match(/Week \d+ of \d+/) ?? ['no week line'])[0]);
bar('...and the plan is not declared finished', !/finished|complete/i.test(afterPause.text));

/* ── probing and ownership ──────────────────────────────────────────────── */

const byId = await api(`/w/${goalId.replace(/-/g, '')}`, { method: 'GET' });
bar('knowing the goal id does not open the page', byId.status === 404);

const stranger = await api('/device/register', { body: {} });
const theft = await api(`/goals/${goalId}/share`, { token: stranger.body.token });
bar("a stranger cannot mint a share link for your goal",
  theft.status === 404 || (theft.body.token && theft.body.token !== shareToken) === false,
  JSON.stringify(theft.body).slice(0, 100));

const strangerUnshare = await api(`/goals/${goalId}/unshare`, { token: stranger.body.token });
const stillLive = await api(`/w/${shareToken}`, { method: 'GET' });
bar("a stranger cannot revoke your share link",
  strangerUnshare.status === 200 && stillLive.status === 200);

/* ── revoke ─────────────────────────────────────────────────────────────── */

await api(`/goals/${goalId}/unshare`, { token });
const revoked = await api(`/w/${shareToken}`, { method: 'GET' });
bar('revoking kills the link immediately',
  revoked.status === 404 && !/Quit smoking/.test(revoked.text));
bar('a revoked link is indistinguishable from one that never existed',
  revoked.text === unshared.text);

const reshared = await api(`/goals/${goalId}/share`, { token });
bar('re-sharing mints a NEW token, never resurrecting the old link',
  reshared.body.token && reshared.body.token !== shareToken);

const failed = results.filter(r => !r.ok).length;
console.log(`\n${failed === 0 ? 'WITNESS CHECK CLEAR' : `WITNESS CHECK FAILED (${failed})`} · ${results.length} bars`);
process.exit(failed === 0 ? 0 : 1);
