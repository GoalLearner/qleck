// Supervised `wrangler dev`.
//
// The local Worker goes down mid-session — sometimes the process exits,
// sometimes it leaves a wedged workerd holding port 8787 while `wrangler`
// itself stays alive. Either way the symptom is identical and unhelpful: the
// web preview shows "the coach hit a snag" on every goal, and the AI ledger
// stays empty, because the request never reaches a server at all.
//
// This keeps exactly ONE healthy worker running.
//
//   npm run dev:watch
//
// Two lessons are baked in, both learned by watching this file misbehave:
//
//  1. Liveness is the wrong signal. Killing the worker does not necessarily
//     kill `wrangler`, so an exit-only supervisor sees nothing wrong while the
//     port serves nobody. Health decides here, not liveness.
//
//  2. A restart needs a single owner. When the watchdog and the exit handler
//     could both trigger one, every recycle spawned two workers that fought
//     over the port, failed, and recycled again — a storm that left a dozen
//     orphaned processes behind. Restarts are generation-guarded now: a child
//     that is no longer the current generation is ignored when it exits.
import { spawn, execSync } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 8787);
const HEALTH = `http://localhost:${PORT}/health`;

const PROBE_MS = 5000;          // how often health is checked
const FAILS_BEFORE_RECYCLE = 3; // consecutive failures that mean "wedged"
const BOOT_GRACE_MS = 90_000;   // wrangler can take 20s+ on a cold start
const MIN_BACKOFF = 2000;
const MAX_BACKOFF = 60_000;
const HEALTHY_RUN_MS = 60_000;  // a run this long resets the backoff

let child = null;
let generation = 0;   // every start bumps this; stale children are ignored
let booted = false;   // has THIS generation ever answered /health?
let startedAt = 0;
let fails = 0;
let backoff = MIN_BACKOFF;
let stopping = false;

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = msg => console.log(`[${stamp()}] supervisor: ${msg}`);

/** Kill a process AND its children. On Windows `proc.kill()` reaches only the
 *  cmd wrapper npx runs under, leaving workerd holding the port — which is
 *  the exact wedge this supervisor exists to clear. */
function killTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); return; } catch { /* fall through */ }
  }
  try { proc.kill(); } catch { /* already gone */ }
}

/** Clear whatever is squatting on the port before binding it. */
function freePort() {
  if (process.platform !== 'win32') {
    try { execSync(`fuser -k ${PORT}/tcp`, { stdio: 'ignore' }); } catch { /* nothing there */ }
    return;
  }
  let out = '';
  try { out = execSync(`netstat -ano -p tcp | findstr :${PORT}`, { encoding: 'utf8' }); } catch { return; }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/LISTENING\s+(\d+)$/);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      log(`cleared stale listener on ${PORT} (pid ${pid})`);
    } catch { /* already gone */ }
  }
}

async function probe() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function start() {
  if (stopping) return;
  freePort();
  generation++;
  const myGen = generation;
  booted = false;
  fails = 0;
  startedAt = Date.now();
  log(myGen === 1 ? 'starting wrangler dev…' : `starting wrangler dev (generation ${myGen})…`);

  child = spawn('npx', ['wrangler', 'dev', '--port', String(PORT)], {
    stdio: 'inherit',
    shell: process.platform === 'win32', // npx on Windows is a .cmd
  });

  child.on('exit', (code, signal) => {
    // A child from a superseded generation exiting is expected — we killed it.
    // Restarting on that is what produced two workers per recycle.
    if (stopping || myGen !== generation) return;
    child = null;
    const ran = Date.now() - startedAt;
    backoff = ran >= HEALTHY_RUN_MS ? MIN_BACKOFF : Math.min(backoff * 2, MAX_BACKOFF);
    log(`exited (${signal ?? `code ${code}`}) after ${Math.round(ran / 1000)}s — restarting in ${backoff / 1000}s`);
    setTimeout(start, backoff);
  });

  child.on('error', err => log(`could not spawn wrangler: ${err.message}`));
}

/** Replace the running worker. The generation bump makes its exit a no-op. */
function recycle(why) {
  if (stopping) return;
  log(`${why} — recycling`);
  const dying = child;
  child = null;
  generation++;            // stale-exit guard, set BEFORE the kill
  killTree(dying);
  backoff = Math.min(backoff * 2, MAX_BACKOFF);
  setTimeout(start, backoff);
}

setInterval(async () => {
  if (stopping || !child) return;
  const health = await probe();

  if (health) {
    if (!booted) {
      booted = true;
      backoff = MIN_BACKOFF;
      log(`up on ${PORT} in ${Math.round((Date.now() - startedAt) / 1000)}s — provider ${health.provider}, ai ${health.ai ? 'enabled' : 'OFF'}`);
    }
    fails = 0;
    return;
  }

  // Still booting: a cold start is slow, and treating that as a wedge is how
  // this file used to kill every worker it started.
  if (!booted) {
    if (Date.now() - startedAt > BOOT_GRACE_MS) recycle(`no health response within ${BOOT_GRACE_MS / 1000}s`);
    return;
  }

  fails++;
  if (fails >= FAILS_BEFORE_RECYCLE) recycle(`worker stopped answering (${fails} probes)`);
  else log(`health probe failed (${fails}/${FAILS_BEFORE_RECYCLE})`);
}, PROBE_MS);

function shutdown() {
  if (stopping) return;
  stopping = true;
  log('shutting down');
  killTree(child);
  freePort();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
