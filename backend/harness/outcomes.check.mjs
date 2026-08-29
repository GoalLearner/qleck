// Fix 2 assertion (owner spec): every goal_outcomes row carries numeric odds.
// Runs after the suite; queries local D1 via wrangler (read-only).
import { execSync } from 'node:child_process';

const sql = 'SELECT COUNT(*) total, SUM(CASE WHEN odds_at_verdict IS NULL THEN 1 ELSE 0 END) null_odds, SUM(verdict_fallback) fallbacks FROM goal_outcomes';
const raw = execSync(`npx wrangler d1 execute qleck --local --json --command "${sql}"`, { encoding: 'utf8' });
const row = JSON.parse(raw)[0].results[0];
console.log(`goal_outcomes: ${row.total} rows, ${row.null_odds} null odds, ${row.fallbacks} rubric fallbacks`);
if (row.null_odds > 0) {
  console.log('FAIL: goal_outcomes rows with null odds exist');
  process.exit(1);
}
console.log('PASS: every outcome row has numeric odds');
