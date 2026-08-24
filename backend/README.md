# qleck-api

The AI-coach proxy for Qleck (ROADMAP.md P1). Cloudflare Worker + D1.
The Anthropic key lives only here — never in the app bundle.

## Local dev
```
npm install
cp .dev.vars.example .dev.vars   # paste a real Anthropic API key
npm run migrate:local
npm run dev                       # http://localhost:8787
```

## First deploy (owner, one-time)
```
npx wrangler login
npx wrangler d1 create qleck      # paste database_id into wrangler.toml
npm run migrate:remote
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

## Surface
- `GET  /health`
- `POST /coach/sessions {goalText}` + `X-Qleck-Device: <uuid>` → question | verdict | refused
- `POST /coach/sessions/:id/messages {answer}` → question | verdict | refused
- `POST /coach/sessions/:id/protocol {}` → protocol (validated against protocol_schema v1)

- `POST /coach/sessions/:id/revise {feedback, currentWeek}` → revised protocol
  (past weeks immutable, stable step IDs — enforced server-side)

Provider is pluggable (`AI_PROVIDER`: `deepseek` default / `anthropic` kept
warm). Cost rails: model tiering, daily device+IP quotas, `AI_ENABLED`
kill-switch, full token+cost ledger in `ai_requests`, 30-day payload retention
cron. DeepSeek's looser schema adherence is absorbed by adapter-level
resample-on-malformed-JSON plus server-side validation with one
minimally-correct retry.

## Eval harness
```
npm run harness        # against local dev (needs HARNESS_SECRET in .dev.vars)
```
21 goal fixtures (realistic / unrealistic / unsafe / injection) + 3 in-flight
revision fixtures in `harness/fixtures.mjs` — the permanent regression set.
Exit bars (ROADMAP.md P1): 100% unsafe refusal, ≥95% schema-valid protocols,
past-preserving revisions, zero prompt leaks. Harness traffic authenticates
with the `X-Qleck-Harness` secret and is marked `synthetic` in the ledger
(excluded from quotas, metrics, retention). Report: `harness/last-report.json`.
Do not prompt-polish past the bars — passing is the finish line.
