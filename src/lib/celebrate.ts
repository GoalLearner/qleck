// The reward ladder's touch + sound layer (owner call 2026-08-25: celebrate
// through more senses). Three tiers, sized to the moment:
//   rep checked   → light haptic tick, no sound
//   goal complete → success haptic + short two-note chime
//   day banked    → heavy haptic salute + rising arpeggio
// Sounds are synthesized in-repo (assets/sfx, no licensing), stay quiet, and
// respect the iOS silent switch (expo-audio default). Haptics no-op on web
// desktop; Android web gets the vibration API where present. Every call is
// fire-and-forget and swallows failures — a celebration must never crash a
// check-in.
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

let goalPlayer: AudioPlayer | null = null;
let dayPlayer: AudioPlayer | null = null;

// Module-level singletons, created on first use and kept for the app's life —
// two tiny players, no leak. (createAudioPlayer over the hook: these fire from
// callbacks, not component render.)
function play(which: 'goal' | 'day') {
  try {
    if (which === 'goal') {
      goalPlayer = goalPlayer ?? createAudioPlayer(require('../../assets/sfx/goal-done.wav'));
      goalPlayer.seekTo(0);
      goalPlayer.play();
    } else {
      dayPlayer = dayPlayer ?? createAudioPlayer(require('../../assets/sfx/day-done.wav'));
      dayPlayer.seekTo(0);
      dayPlayer.play();
    }
  } catch { /* sound is a garnish, never an error */ }
}

function vibrate(pattern: number | number[]) {
  try {
    (globalThis as { navigator?: { vibrate?: (p: number | number[]) => void } })
      .navigator?.vibrate?.(pattern);
  } catch { /* not supported — fine */ }
}

/** Tier 1 — a rep was checked: the smallest possible acknowledgment. */
export function hapticCheck(): void {
  if (Platform.OS === 'web') { vibrate(10); return; }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Tier 2 — a goal's last rep of the day landed. */
export function celebrateGoal(): void {
  if (Platform.OS === 'web') vibrate([18, 40, 24]);
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  play('goal');
}

/** Tier 4 — a whole PLAN finished. The rarest moment the app has: weeks of
 * work, not a day of it. Same salute, held longer. */
export function celebratePlan(): void {
  if (Platform.OS === 'web') vibrate([30, 70, 30, 70, 30, 90, 60]);
  else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    [140, 280, 430, 600].forEach((delay, i) => {
      setTimeout(() => {
        Haptics.impactAsync(
          i >= 2 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium,
        ).catch(() => {});
      }, delay);
    });
  }
  play('day');
}

/** Tier 3 — the whole day is banked: the salute. */
export function celebrateDay(): void {
  if (Platform.OS === 'web') vibrate([24, 60, 24, 60, 40]);
  else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), 180);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 360);
  }
  play('day');
}
