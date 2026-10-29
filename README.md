# Qleck

Qleck is an AI goal coach (iOS, built with Expo). You type a goal in your own words; the coach asks a few questions, gives an honest feasibility verdict (counter-offers and refusals included), then builds a step-by-step plan you live day by day. Every plan rests on the habit loop and the Four Laws from *Atomic Habits*, kept jargon-free.

**Stack:** React Native + Expo SDK 56 (TypeScript) in `src/`; a Cloudflare Worker API in `backend/` on D1 + Queues; DeepSeek by default (Anthropic kept warm) behind a validated protocol schema; email OTP via Resend and Sign in with Apple; an eval harness in `backend/harness` that gates every prompt change.

**Run it:**

```bash
npm install && npm start                                       # the app (press i / a / w)
cd backend && npm install && cp .dev.vars.example .dev.vars    # then add a DeepSeek key
npm run migrate:local && npm run dev                           # API on http://localhost:8787
```

`npm run check` runs the app checks plus `tsc`; `cd backend && npm run harness` runs the coach evals. More in `docs/ROADMAP.md` and `docs/CHANGELOG.md`. Ships through TestFlight.

Built with Claude Code.
