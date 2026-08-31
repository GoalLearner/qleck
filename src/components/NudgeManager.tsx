// Renders nothing; keeps the pending local-notification set mirroring
// reality (ROADMAP P4). Reschedules — debounced — whenever goals, check-ins
// or nudge prefs change, and on every foreground, so banking the last rep
// cancels tonight's nudge and a finished or muted goal goes quiet.
//
// Also owns the FUNNEL-path permission moment: the funnel itself never shows
// an OS prompt (P3 rule), so the first Home mount with a live goal asks —
// but only when the user said yes on the funnel's permissions screen. The
// in-app accept moment (NewGoal lock) asks directly.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  ensureNudgePermission, getNudgePermission, loadNudgePrefs, onNudgePrefsChanged,
  rescheduleNudges, type NudgePrefs,
} from '../lib/nudges';
import { useRally } from '../state/RallyContext';

export default function NudgeManager() {
  const { liveGoals, checkInsByGoal, profile } = useRally();
  const prefsRef = useRef<NudgePrefs | null>(null);
  const [prefsTick, setPrefsTick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadNudgePrefs().then(p => { if (alive) { prefsRef.current = p; setPrefsTick(t => t + 1); } });
    const off = onNudgePrefsChanged(p => { prefsRef.current = p; setPrefsTick(t => t + 1); });
    return () => { alive = false; off(); };
  }, []);

  // Funnel-path ask: once, when a goal exists, prefs allow it, the OS was
  // never asked, and the user opted in on the funnel's permissions screen.
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || liveGoals.length === 0) return;
    const p = prefsRef.current;
    if (!p?.enabled || !profile.allowNotifications) return;
    askedRef.current = true;
    void getNudgePermission().then(async status => {
      if (status === 'undetermined') {
        await ensureNudgePermission();
        setPrefsTick(t => t + 1); // grant → lay the schedule now
      }
    });
  }, [liveGoals.length, prefsTick, profile.allowNotifications]);

  // The reschedule loop. Debounced: a burst of check-ins rebuilds once.
  useEffect(() => {
    const p = prefsRef.current;
    if (!p) return;
    const t = setTimeout(() => { void rescheduleNudges(liveGoals, checkInsByGoal, p); }, 1500);
    return () => clearTimeout(t);
  }, [liveGoals, checkInsByGoal, prefsTick]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      const p = prefsRef.current;
      if (state === 'active' && p) void rescheduleNudges(liveGoals, checkInsByGoal, p);
    });
    return () => sub.remove();
  }, [liveGoals, checkInsByGoal]);

  return null;
}
