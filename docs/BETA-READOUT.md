# The beta readout

ROADMAP **P6**, final bullet: *"instrumented **before** testers arrive"*.
This is that instrument, and it is live now so the first tester's first day
is already being measured.

```bash
curl -H "X-Qleck-Admin: $ADMIN_METRICS_SECRET" \
  https://qleck-api.richmondcampano93.workers.dev/admin/readout
```

`?days=N` changes the window (default 30). Without the secret the route
returns **404, not 403** — an unconfigured admin door should not advertise
that it exists.

Set it once:

```bash
cd backend && npx wrangler secret put ADMIN_METRICS_SECRET
```

## What each number means, and what it does not

| Field | Reading it honestly |
|---|---|
| `active_users.d1/d7/d30` | **Sync recency, never app-opens.** Stamped when a device actually talks to the server. The OS resuming a backgrounded app is not a user; counting opens flatters this number and has burned this owner before. |
| `activation.pct` | Registered → got at least one goal. The funnel's real conversion. A low number here means the coach conversation is the drop-off, not the sign-up. |
| `retention.pct` | **D7, active goals only.** Of goals that have been running at least a week, how many still had a check-in on day 7 or later. Goals deliberately completed or dropped are excluded — a finished plan is a success, and counting it as churn would make a working product look like a leaking one. |
| `coach.counter_offer_acceptance_pct` | Of sessions where Qoach countered, how many still ended in a saved plan. **This is the honesty thesis under test:** if people abandon at the counter, the honesty is costing more than it earns. |
| `adaptation.pct` | Goals whose protocol reached version 2+. Whether "Adjust my plan" is a feature or a decoration. |
| `cost.usd_per_active_user` | The unit economics. Watch it against the retention number: cheap and unretained is worse than dear and retained. |
| `health.*` | Client errors, distinct error messages, AI reports. A rising `distinct_error_messages` matters more than a rising count — one loud bug is fine, ten quiet ones are not. |
| `witness.goals_shared` | How many goals have a live witness link. **This is what decides P4.5 bullet 2 and the pact-app question** — if nobody shares, accountability is not the wedge. |

Harness traffic is excluded from cost and verdict counts (`synthetic = 1`).
Anonymous device rows do count as registered users, which is correct: an
anonymous device that built a goal is a real person using the product.

## Go / no-go

The roadmap asks for a written readout, not a dashboard. When 5–10 real
testers have each lived a goal for a week, take these numbers and write two
paragraphs: what the retention and counter-offer-acceptance figures say about
the thesis, and whether cost per retained user is survivable. That document
is the P6 exit, not this endpoint.
