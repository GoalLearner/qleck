/**
 * The privacy policy and terms, served as HTML from the API.
 *
 * They live here rather than in docs/ because there must be exactly ONE copy:
 * a policy that drifts from the app it describes is worse than no policy, and
 * two files inevitably drift. Everything below is derived from what the code
 * actually does — the tables, the purge, the retention cron, the subprocessors
 * in docs/REVIEW.md §5 — not from a template.
 *
 * Hosting them here means no new infrastructure and no domain purchase: the
 * worker is already public, so the URLs are live the moment this deploys.
 * Point App Store Connect at them. If a custom domain lands later (it has to,
 * for Resend), these move with it and keep working.
 *
 * NOT LEGAL ADVICE, and not written by a lawyer. It is an honest, specific
 * description of real data flows, which is the part a template cannot do. For
 * an app that touches health-adjacent goals, having someone qualified read it
 * before launch is worth the money.
 */

/* ── the three things code cannot know. Set before submission. ──────────── */

/** Where people reach a human. Public the moment this deploys. */
const CONTACT_EMAIL = 'richmondcampano93@gmail.com';
/** Who "we" is, legally — a person's name is fine for a solo app. */
const LEGAL_ENTITY = 'Richmond Campano';
/** Whose law governs, e.g. "the State of Florida, USA". */
const JURISDICTION = 'the State of California, USA';

/** Last substantive change. Bump when the text changes, not on redeploys. */
const EFFECTIVE = '3 September 2026';

const UNSET = /^TODO-SET-/;

function shell(title: string, body: string): string {
  // A visible banner rather than a silent placeholder: an unfinished policy
  // that LOOKS finished is the failure mode worth engineering against.
  const todo = [CONTACT_EMAIL, LEGAL_ENTITY, JURISDICTION].some(v => UNSET.test(v))
    ? `<p class="todo"><strong>This document is not final.</strong> Contact,
       legal entity and governing law are still placeholders.</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Qleck</title>
<style>
:root { color-scheme: light dark; --ink:#262b33; --muted:#5d636e; --bg:#f5f2ea; --rule:rgba(38,43,51,.12); --accent:#47694f; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#F2F5F4; --muted:rgba(242,245,244,.65); --bg:#0C0F14; --rule:rgba(255,255,255,.12); --accent:#2BE380; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  padding:40px 22px 90px; }
main { max-width:680px; margin:0 auto; }
h1 { font-size:30px; line-height:1.2; margin:0 0 6px; letter-spacing:-.4px; }
h2 { font-size:18px; margin:38px 0 10px; padding-top:18px; border-top:1px solid var(--rule); }
p, li { color:var(--muted); }
li { margin:6px 0; }
strong { color:var(--ink); }
.date { color:var(--muted); font-size:14px; margin:0 0 8px; }
.todo { border:1px solid #c96f5f; background:rgba(201,111,95,.1); color:var(--ink);
  padding:12px 14px; border-radius:10px; font-size:14px; }
a { color:var(--accent); }
footer { margin-top:44px; padding-top:18px; border-top:1px solid var(--rule); font-size:13px; color:var(--muted); }
</style>
</head><body><main>
<h1>${title}</h1>
<p class="date">Effective ${EFFECTIVE}</p>
${todo}
${body}
<footer>Qleck · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>
</main></body></html>`;
}

export function privacyHtml(): string {
  return shell('Privacy Policy', `
<p>Qleck is an AI goal coach. You tell it what you want to achieve, it asks a
few questions, and it either builds you a plan or tells you honestly that the
goal as stated will not work. This describes exactly what that involves for
your data. It is deliberately specific rather than broad: where a limit is
real, it is stated as a limit.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Your goal, in your words</strong>, and your answers to the coach's
questions. This is the heart of the service and it is the most personal thing
we hold — people describe their weight, their drinking, their sleep, their
money.</li>
<li><strong>Your plan</strong> and every check-in you record against it.</li>
<li><strong>Your email address</strong>, if you sign up with email. If you use
Sign in with Apple you may use Hide My Email, and we never see the real
one.</li>
<li><strong>A name and username</strong>, if you give them. Both are optional
and both are only ever shown back to you.</li>
<li><strong>Identifiers</strong> — a device id and a user id. The device id
exists so the app works before you make an account, and so we can apply cost
and abuse limits.</li>
<li><strong>Crash and error reports</strong>, kept 30 days.</li>
</ul>

<p><strong>We do not collect</strong> your location, contacts, photos, health
records, browsing history, advertising identifiers, or payment details. There
is no tracking, no third-party analytics, and no advertising. Your data is
never sold, and never shared for advertising.</p>

<h2>Where your words go</h2>
<p>To build a plan, your goal text and your interview answers are sent to
<strong>DeepSeek</strong>, the AI provider that generates verdicts and plans.
This is the one place your own words leave our systems, and it is unavoidable:
it is how the coaching works. The app tells you this before you type anything.</p>
<p>We also rely on <strong>Cloudflare</strong> for hosting and the database,
and <strong>Resend</strong> to email you a sign-in code. Resend receives your
email address; it never receives your goals.</p>

<h2>How long it is kept</h2>
<ul>
<li><strong>The exact text sent to and returned by the AI is deleted after 30
days</strong> by a nightly job. What remains is a cost record — model, token
counts, price — containing none of your words.</li>
<li><strong>Your goals, plans and check-ins are kept while your account
exists</strong>, because they are the thing you came for.</li>
<li><strong>Error reports are deleted after 30 days.</strong></li>
</ul>

<h2>Deleting everything</h2>
<p>The You tab has <strong>Delete account</strong>. It is immediate and it is
thorough: your account, goals, plans, check-ins, interview answers, coaching
sessions, sign-in identities and tokens are erased. The billing record of what
our AI provider charged us survives, because it is our spend history rather
than your data — and it is stripped of any link to you, your device or your IP
before it does.</p>
<p>There is no waiting period, no email to send, and no dark pattern between
you and the button.</p>

<h2>Getting a copy</h2>
<p>The You tab has <strong>Download my data</strong>, which produces a readable
JSON document of your account, every goal, the current version of each plan,
and every check-in. It is written to be read by a person, not merely to satisfy
a regulation.</p>

<h2>Sharing a goal</h2>
<p>You can create a link that lets someone else see one goal. It is off by
default and you can revoke it at any moment, which kills the link instantly.</p>
<p>The page is deliberately thin. It shows the coach's short title for the goal
and the days you showed up — <strong>never the words you typed, never your
answers, and never your misses</strong>. Someone with the link cannot see your
name, your email, your other goals, or anything you failed to do.</p>

<h2>Age</h2>
<p>Qleck is for people aged 13 and over, and the app asks you to confirm that
before either sign-in door opens. We ask for a confirmation rather than a date
of birth on purpose: a birthdate is personal data we would then have to store,
protect and erase, and it buys nothing the confirmation does not.</p>

<h2>Your rights</h2>
<p>You can export your data and delete your account from inside the app, at any
time, without asking us. If you are in the UK, EU or another region with data
protection law, those rights include access, correction, erasure, portability
and objection — the first four are buttons in the app, and for anything else
write to us.</p>

<h2>Changes</h2>
<p>If this policy changes in a way that matters, the effective date above
changes and the app will tell you. We will not quietly broaden what we do with
your words.</p>

<h2>Contact</h2>
<p>${LEGAL_ENTITY} — <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
`);
}

export function termsHtml(): string {
  return shell('Terms of Use', `
<p>These are the terms for using Qleck. Plain language on purpose: if a term
matters enough to enforce, it matters enough to state clearly.</p>

<h2>What Qleck is</h2>
<p>Qleck is an AI coach that assesses a goal you describe and, when it judges
the goal achievable, builds you a step-by-step plan to follow. It will
sometimes refuse a goal, or offer you a different one it thinks you can
actually finish. That is the product working as intended, not a fault.</p>

<h2>What Qleck is not</h2>
<p><strong>It is not medical, psychological, nutritional, financial or legal
advice, and it is not a substitute for a professional.</strong> It does not
know your medical history and cannot examine you. If a goal touches your
health, talk to a doctor — particularly if you are pregnant, managing a
condition, taking medication, or have a history of disordered eating.</p>
<p>The coach refuses goals that need clinical supervision, and refuses
starvation, purging and punishing regimes for everyone regardless of stated
age. Those refusals are a safety floor, not a diagnosis, and the absence of a
refusal is not a medical clearance.</p>
<p><strong>You are responsible for what you choose to do.</strong> Stop if
something hurts.</p>

<h2>AI, and being wrong</h2>
<p>Plans and assessments are generated by an AI model. It can be wrong, and the
percentage it gives you is a considered estimate rather than a measurement or a
promise. Use your judgement. Every verdict and plan has a way to report a
response you think is harmful or wrong, and we read those.</p>

<h2>Your account</h2>
<p>You must be 13 or older. Keep your sign-in details to yourself; anything
done through your account is treated as done by you. You may delete your
account at any time from the You tab, which erases your data as described in
the <a href="/privacy">Privacy Policy</a>.</p>

<h2>Fair use</h2>
<p>Do not use Qleck to harm yourself or anyone else, do not try to break,
overload or reverse-engineer it, and do not use it to generate content that is
illegal or abusive. There are per-day limits on AI requests, because each one
costs real money; they exist to keep the service running for everybody, not to
frustrate you.</p>

<h2>Availability</h2>
<p>We do our best to keep Qleck working, but it is provided as it is, without
warranty. It may be unavailable, and features may change or be withdrawn.
Nothing here is a guarantee that you will reach any goal — that part is yours,
and the app is honest with you about the odds precisely because we cannot
promise it.</p>

<h2>Liability</h2>
<p>To the extent the law allows, ${LEGAL_ENTITY} is not liable for indirect or
consequential loss arising from your use of Qleck. Nothing in these terms
limits liability that cannot lawfully be limited — including for death or
personal injury caused by negligence, or for fraud.</p>

<h2>Ending it</h2>
<p>You can stop using Qleck and delete your account whenever you like. We may
suspend an account that is breaking these terms or putting the service at
risk.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of ${JURISDICTION}.</p>

<h2>Contact</h2>
<p>${LEGAL_ENTITY} — <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
`);
}
