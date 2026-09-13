// Qoach surface tokens. "Electric Night" (dark) is ported 1:1 from the Claude
// Design canvas `Qleck Onboarding.dc.html` (project 7091d355); the light twin
// maps the same token names onto the Rally cream canvas.
//
// The coach used to be a permanent dark sub-brand while the app stayed cream.
// That split is gone (owner call 2026-08-25): one appearance setting drives
// BOTH, so the funnel and the tabs never disagree. Like `colors`, `night` is a
// LIVE object — applyNight() rewrites it in place; never reassign it.
import { Platform } from 'react-native';
import type { ThemeMode } from '../theme';

export interface NightPalette {
  bg: string; surface: string; surfaceDeep: string;
  /** A sheet lifted above `surface` (the intake's date wheel). */
  surfaceRaised: string;
  accent: string; accentInk: string; accentSoft: string; accentSofter: string;
  accentTint: string; accentBorder: string; accentBorderStrong: string;
  accentFaint: string; accentGlow: string; accentText: string;
  text: string; textMuted: string; textSoft: string; textDim: string;
  textFaint: string; textGhost: string;
  /** Near-full text for unselected controls (the intake's pills). */
  textStrong: string;
  hairline: string; border: string; borderMuted: string; borderStrong: string;
  borderDashed: string;
  danger: string; warn: string; violet: string; violetText: string; blue: string;
  scrim: string;
}

export const NIGHT_DARK: NightPalette = {
  bg: '#0C0F14',
  surface: '#151B24',
  surfaceDeep: '#11161E',
  surfaceRaised: '#1C222B',

  accent: '#2BE380',
  accentInk: '#07130C',
  accentSoft: 'rgba(43,227,128,0.12)',
  accentSofter: 'rgba(43,227,128,0.1)',
  accentTint: 'rgba(43,227,128,0.14)',
  accentBorder: 'rgba(43,227,128,0.5)',
  accentBorderStrong: 'rgba(43,227,128,0.6)',
  accentFaint: 'rgba(43,227,128,0.2)',
  accentGlow: 'rgba(43,227,128,0.25)',
  accentText: '#7DF0B2',

  text: '#F2F5F4',
  textMuted: 'rgba(242,245,244,0.6)',
  textSoft: 'rgba(242,245,244,0.55)',
  textDim: 'rgba(242,245,244,0.5)',
  textFaint: 'rgba(242,245,244,0.45)',
  textGhost: 'rgba(242,245,244,0.4)',
  textStrong: 'rgba(242,245,244,0.85)',

  hairline: 'rgba(255,255,255,0.1)',
  border: 'rgba(255,255,255,0.12)',
  borderMuted: 'rgba(255,255,255,0.14)',
  borderStrong: 'rgba(255,255,255,0.16)',
  borderDashed: 'rgba(255,255,255,0.25)',

  danger: '#FF6B6B',
  warn: '#F7B32B',
  violet: '#8B5CF6',
  violetText: '#B69CFF',
  blue: '#0E9FE8',

  scrim: 'rgba(5,8,12,0.72)',
};

// Same tokens, cream room. The signature green stays the accent but drops to a
// weight that can carry cream text and read as ink on a light card.
export const NIGHT_LIGHT: NightPalette = {
  bg: '#f5f2ea',
  surface: '#fffefb',
  surfaceDeep: '#efece1',
  surfaceRaised: '#ffffff',

  accent: '#2f8f5b',
  accentInk: '#ffffff',
  accentSoft: 'rgba(47,143,91,0.1)',
  accentSofter: 'rgba(47,143,91,0.08)',
  accentTint: 'rgba(47,143,91,0.12)',
  accentBorder: 'rgba(47,143,91,0.45)',
  accentBorderStrong: 'rgba(47,143,91,0.6)',
  accentFaint: 'rgba(47,143,91,0.18)',
  accentGlow: 'rgba(47,143,91,0.22)',
  accentText: '#2b6b47',

  text: '#262b33',
  textMuted: 'rgba(38,43,51,0.62)',
  textSoft: 'rgba(38,43,51,0.58)',
  textDim: 'rgba(38,43,51,0.52)',
  textFaint: 'rgba(38,43,51,0.46)',
  textGhost: 'rgba(38,43,51,0.42)',
  textStrong: 'rgba(38,43,51,0.85)',

  hairline: 'rgba(38,43,51,0.08)',
  border: 'rgba(38,43,51,0.1)',
  borderMuted: 'rgba(38,43,51,0.12)',
  borderStrong: 'rgba(38,43,51,0.16)',
  borderDashed: 'rgba(38,43,51,0.25)',

  danger: '#a05a5a',
  warn: '#8a5f38',
  violet: '#6d4bc4',
  violetText: '#5b4bb8',
  blue: '#2f6fa8',

  scrim: 'rgba(38,43,51,0.4)',
};

/** The live Qoach palette. Mutated by applyNight(); never reassign. */
export const night: NightPalette = { ...NIGHT_DARK };

export function applyNight(mode: ThemeMode): void {
  Object.assign(night, mode === 'dark' ? NIGHT_DARK : NIGHT_LIGHT);
}

export const nightFonts = {
  // Space Grotesk 700 is the only display weight the canvas uses.
  display: 'SpaceGrotesk_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
};

// Avatar / friend gradients. Index 0 is "no photo yet" — `avatarCycle` walks
// 1 → 2 → 3 → 1, exactly like the canvas.
export const AVATAR_GRADS: [string, string][] = [
  ['#2BE380', '#0E9FE8'], // 0 is unused as a fill; kept so indices line up
  ['#2BE380', '#0E9FE8'],
  ['#8B5CF6', '#2BE380'],
  ['#F7B32B', '#FF6B6B'],
  ['#0E9FE8', '#8B5CF6'], // 4 — suggested-friend only, never reachable via avatarCycle
];

// 135deg linear-gradient → LinearGradient start/end.
export const DIAGONAL = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

export const CONFETTI_COLORS = ['#2BE380', '#0E9FE8', '#8B5CF6', '#F7B32B', '#FF6B6B', '#F2F5F4'];
