// Qleck design tokens. Two palettes, one shape (owner call 2026-08-25: the
// app and the Qoach surfaces must always match, with a light/dark choice).
//
// `colors` is a LIVE object: applyPalette() rewrites it in place and the theme
// provider re-renders the tree, so every `import { colors }` call site reskins
// without touching a single screen. This only works because the app styles
// inline — there is no StyleSheet.create in the codebase, and adding one with
// palette colors would freeze those styles to whichever mode was active first.
//
// Light is the Rally cream canvas, ported 1:1 from the design project. Dark is
// aligned to the Qoach "Electric Night" surfaces (src/onboarding/theme.ts), so
// crossing between the coach and the app never changes the room's lighting.
export type ThemeMode = 'light' | 'dark';

export interface Palette {
  bg: string; card: string; ink: string; navy: string; loginNavy: string;
  cream: string; creamText: string; onNavyMuted: string; onNavySoft: string;
  muted: string; sectionLabel: string; inkSoft: string; inkFaint: string;
  accent: string; accentLink: string;
  border: string; borderStrong: string; hairline: string; inputBorder: string;
  outline: string; outlineStrong: string;
  ringTrack: string; trackIdle: string; dotUpcoming: string;
  dashed: string; tabIdle: string; tabBarBg: string; faintText: string;
  danger: string; dangerBorder: string; missed: string;
  chipIdleBg: string; chipBg: string; disabledSend: string; chevron: string;
  shadow: string;
  // success / "banked" family
  success: string; successBg: string; successFg: string; successDot: string;
  successBorder: string; doneBg: string; doneBorder: string;
  // rep-kind chips
  durationBg: string; durationFg: string;
  quantityBg: string; quantityFg: string;
  // milestone / "needs a yes" card
  inviteBg: string; inviteBorder: string; inviteAccent: string;
  inviteBtnBorder: string; inviteBtnText: string;
  openBg: string; openBorder: string;
  youRowBg: string; dotIdle: string; dotIdleFg: string;
  outBg: string; outFg: string;
  // one dot per concurrent goal, by position
  goalDots: string[];
}

export const LIGHT: Palette = {
  bg: '#f5f2ea',
  card: '#fffefb',
  ink: '#262b33',
  navy: '#212836',
  loginNavy: '#1d2330',
  cream: '#f5f2ea',
  creamText: '#f2efe7',
  onNavyMuted: 'rgba(245,242,234,0.65)',
  onNavySoft: 'rgba(242,239,231,0.55)',
  muted: '#8a8f9b',
  sectionLabel: '#a09c8e',
  inkSoft: 'rgba(38,43,51,0.75)',
  inkFaint: 'rgba(38,43,51,0.35)',
  accent: '#5a6b85',
  accentLink: '#46536a',
  border: 'rgba(38,43,51,0.07)',
  borderStrong: 'rgba(38,43,51,0.08)',
  hairline: 'rgba(38,43,51,0.06)',
  inputBorder: 'rgba(38,43,51,0.1)',
  outline: 'rgba(38,43,51,0.18)',
  outlineStrong: 'rgba(38,43,51,0.15)',
  ringTrack: '#edebdf',
  trackIdle: 'rgba(38,43,51,0.12)',
  dotUpcoming: 'rgba(38,43,51,0.22)',
  dashed: '#cfccbe',
  tabIdle: '#a0a4ad',
  tabBarBg: 'rgba(255,254,251,0.94)',
  faintText: '#5f6470',
  danger: '#a05a5a',
  dangerBorder: 'rgba(160,90,90,0.35)',
  missed: '#c96f5f',
  chipIdleBg: '#edebe0',
  chipBg: 'rgba(38,43,51,0.05)',
  disabledSend: '#c9c6ba',
  chevron: '#c1beb2',
  shadow: '#232a38',
  success: '#47694f',
  successBg: '#dcecdf',
  successFg: '#47694f',
  successDot: '#cfe3d4',
  successBorder: 'rgba(71,105,79,0.35)',
  doneBg: '#eef4ec',
  doneBorder: '#dcecdf',
  durationBg: '#e6eaf2',
  durationFg: '#46536a',
  quantityBg: '#e4e6f4',
  quantityFg: '#4d5680',
  inviteBg: '#f6efdc',
  inviteBorder: '#eadfc0',
  inviteAccent: '#8a5f38',
  inviteBtnBorder: '#d9cda8',
  inviteBtnText: '#7a6c35',
  openBg: '#e6eaf2',
  openBorder: '#d5dbe8',
  youRowBg: '#eef0f7',
  dotIdle: '#eceadf',
  dotIdleFg: '#b5b1a4',
  outBg: '#f0eee6',
  outFg: '#9a978c',
  goalDots: ['#47694f', '#4d5680', '#8a5f38', '#4f8fc9', '#c96f5f'],
};

export const DARK: Palette = {
  bg: '#0C0F14',
  card: '#151B24',
  ink: '#F2F5F4',
  navy: '#1B222D',
  loginNavy: '#11161E',
  cream: '#0C0F14',
  creamText: '#F2F5F4',
  onNavyMuted: 'rgba(242,245,244,0.62)',
  onNavySoft: 'rgba(242,245,244,0.5)',
  muted: 'rgba(242,245,244,0.6)',
  sectionLabel: 'rgba(242,245,244,0.45)',
  inkSoft: 'rgba(242,245,244,0.78)',
  inkFaint: 'rgba(242,245,244,0.35)',
  accent: '#7DF0B2',
  accentLink: '#7CC9F0',
  border: 'rgba(255,255,255,0.1)',
  borderStrong: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.08)',
  inputBorder: 'rgba(255,255,255,0.16)',
  outline: 'rgba(255,255,255,0.22)',
  outlineStrong: 'rgba(255,255,255,0.2)',
  ringTrack: 'rgba(255,255,255,0.1)',
  trackIdle: 'rgba(255,255,255,0.14)',
  dotUpcoming: 'rgba(255,255,255,0.24)',
  dashed: 'rgba(255,255,255,0.25)',
  tabIdle: 'rgba(242,245,244,0.45)',
  tabBarBg: 'rgba(21,27,36,0.94)',
  faintText: 'rgba(242,245,244,0.55)',
  danger: '#FF6B6B',
  dangerBorder: 'rgba(255,107,107,0.4)',
  missed: '#FF8B7A',
  chipIdleBg: '#1B222D',
  chipBg: 'rgba(255,255,255,0.07)',
  disabledSend: 'rgba(255,255,255,0.25)',
  chevron: 'rgba(242,245,244,0.35)',
  shadow: '#000000',
  success: '#2BE380',
  successBg: 'rgba(43,227,128,0.16)',
  successFg: '#7DF0B2',
  successDot: 'rgba(43,227,128,0.4)',
  successBorder: 'rgba(43,227,128,0.45)',
  doneBg: 'rgba(43,227,128,0.09)',
  doneBorder: 'rgba(43,227,128,0.24)',
  durationBg: 'rgba(14,159,232,0.16)',
  durationFg: '#7CC9F0',
  quantityBg: 'rgba(139,92,246,0.18)',
  quantityFg: '#B69CFF',
  inviteBg: 'rgba(247,179,43,0.1)',
  inviteBorder: 'rgba(247,179,43,0.26)',
  inviteAccent: '#F0C46A',
  inviteBtnBorder: 'rgba(247,179,43,0.34)',
  inviteBtnText: '#F0C46A',
  openBg: 'rgba(14,159,232,0.16)',
  openBorder: 'rgba(14,159,232,0.3)',
  youRowBg: '#1B222D',
  dotIdle: 'rgba(255,255,255,0.12)',
  dotIdleFg: 'rgba(242,245,244,0.4)',
  outBg: 'rgba(255,255,255,0.07)',
  outFg: 'rgba(242,245,244,0.5)',
  goalDots: ['#2BE380', '#8FA3D9', '#F0C46A', '#7CC9F0', '#FF8B7A'],
};

/** The live palette every screen imports. Never reassign it — mutate it. */
export const colors: Palette = { ...LIGHT };

export function applyPalette(mode: ThemeMode): void {
  Object.assign(colors, mode === 'dark' ? DARK : LIGHT);
}

// Category palettes (event color coding) — legacy Rally surfaces only.
export const CATS = {
  mint: { bg: '#dcecdf', fg: '#47694f' },
  lav: { bg: '#e4e6f4', fg: '#4d5680' },
  peach: { bg: '#f6e5d4', fg: '#8a5f38' },
  butter: { bg: '#f2ecd2', fg: '#7a6c35' },
  rose: { bg: '#f4e0e0', fg: '#8a4f4f' },
} as const;

export type CatKey = keyof typeof CATS;

export const fonts = {
  serif: 'YoungSerif_400Regular',
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const radii = {
  card: 26,
  row: 24,
  pill: 999,
  input: 18,
  dateTile: 16,
};
