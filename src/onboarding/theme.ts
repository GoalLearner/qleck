// "Electric Night" — onboarding design tokens, ported 1:1 from the Claude
// Design canvas `Qleck Onboarding.dc.html` (project 7091d355).
//
// Deliberately separate from `src/theme.ts`: the in-app product uses the warm
// cream Rally palette, the onboarding funnel uses this dark one. Keep the two
// token sets apart so neither drifts into the other.
import { Platform } from 'react-native';

export const night = {
  bg: '#0C0F14',
  surface: '#151B24',
  surfaceDeep: '#11161E',

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
} as const;

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
