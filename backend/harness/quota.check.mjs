// Who the AI ledger says a call was for — and who the daily limit counts.
//
//   node harness/quota.check.mjs
//
// ai_requests.user_id existed since migration 0002 and was never written, so
// the per-account limit was a user id compared against the device column: it
// could not match, and only the 450/IP rail was ever real. The same silence
// meant account erasure found nothing in the ledger.
//
// The counting query is not re-implemented here — it is LIFTED out of
// src/ai.ts and run against the local database, so the bar cannot drift from
// the server, and the AND/OR precedence (the easy way to write this wrong) is
// proven rather than assumed.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sql = q => {
  const out = execSync(`npx wrangler d1 execute qleck --local --json --command "${q.replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`, {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\//, ''), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.replace(/^[^[]*/, ''))[0].results;
};

console.log('\nwho the ledger is for\n');

const ai = readFileSync(new URL('../src/ai.ts', import.meta.url), 'utf8');

/* ── the row carries the account ──────────────────────────────────────── */
ok('the ledger INSERT names user_id', /INSERT INTO ai_requests \(id, session_id, device_id, user_id,/.test(ai));
ok('…on the success path and the failure path', (ai.match(/userId: meta\.userId \?\? null,/g) ?? []).length === 2);
ok('CallMeta carries it', /userId\?: string \| null;/.test(ai));

const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
ok('the coach block resolves the account BEFORE the quota and puts it on the meta',
  index.indexOf('const coachUser = await verifyToken') > 0
  && index.indexOf('const coachUser = await verifyToken') < index.indexOf('checkQuota(env, { userId: coachUser')
  && /const meta = \{ deviceId, userId: coachUser, ip, synthetic: isHarness \}/.test(index));

const account = readFileSync(new URL('../src/account.ts', import.meta.url), 'utf8');
ok('erasure clears rows keyed by the account', /UPDATE ai_requests SET user_id = NULL, ip = NULL WHERE user_id = \?/.test(account));
ok('…and sweeps the legacy rows the goal routes wrote under the user id',
  /UPDATE ai_requests SET device_id = NULL, ip = NULL WHERE device_id = \?\`\)\.bind\(userId\)/.test(account));

/* ── the counting query, run for real ─────────────────────────────────── */
{
  // Lifted from the source: whatever the server counts, this counts.
  const m = /SELECT COUNT\(\*\) AS n FROM ai_requests\s+WHERE synthetic = 0[\s\S]*?\)\)`/.exec(ai);
  ok('the per-caller count query is in ai.ts where this bar can lift it', !!m);
  const query = m ? m[0].replace(/`$/, '') : '';
  const U = 'aaaaaaaa-0000-4000-8000-00000000da71';
  const D = 'aaaaaaaa-1111-4000-8000-00000000da71';
  const row = (id, user, device, synthetic) =>
    `INSERT OR REPLACE INTO ai_requests (id, session_id, device_id, user_id, ip, kind, model, input_tokens, output_tokens, cost_usd, synthetic) VALUES ('${id}', NULL, ${device ? `'${device}'` : 'NULL'}, ${user ? `'${user}'` : 'NULL'}, NULL, 'coach_turn', 'test', 0, 0, 0, ${synthetic})`;
  sql(`DELETE FROM ai_requests WHERE id LIKE 'quota-check-%'`);
  sql(row('quota-check-1', U, null, 0));       // this account, another device
  sql(row('quota-check-2', null, D, 0));       // this device, signed out
  sql(row('quota-check-3', U, D, 1));          // synthetic: never counted
  const count = (u, d) => Number(sql(query.replace(/\?1/g, u ? `'${u}'` : 'NULL').replace(/\?2/g, d ? `'${d}'` : 'NULL'))[0].n);

  ok('a signed-in caller is counted by account AND by the device in front of them', count(U, D) === 2, String(count(U, D)));
  ok('…which is what the old query could never do (a user id against the device column)', count(U, null) === 1, String(count(U, null)));
  ok('an anonymous caller is counted by device alone', count(null, D) === 1, String(count(null, D)));
  ok('harness traffic is never counted', count(U, D) === 2 && sql(`SELECT COUNT(*) AS n FROM ai_requests WHERE id LIKE 'quota-check-%'`)[0].n === 3);
  sql(`DELETE FROM ai_requests WHERE id LIKE 'quota-check-%'`);
}

console.log(`\n${failures.length ? `QUOTA CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `QUOTA CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
