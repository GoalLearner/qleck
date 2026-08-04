// Rally design tokens — ported 1:1 from the Rally App design canvas.
export const colors = {
  bg: '#f5f2ea',
  card: '#fffefb',
  ink: '#262b33',
  navy: '#212836',
  loginNavy: '#1d2330',
  cream: '#f5f2ea',
  creamText: '#f2efe7',
  muted: '#8a8f9b',
  sectionLabel: '#a09c8e',
  accent: '#5a6b85',
  accentLink: '#46536a',
  border: 'rgba(38,43,51,0.07)',
  borderStrong: 'rgba(38,43,51,0.08)',
  hairline: 'rgba(38,43,51,0.06)',
  inputBorder: 'rgba(38,43,51,0.1)',
  ringTrack: '#edebdf',
  dashed: '#cfccbe',
  tabIdle: '#a0a4ad',
  faintText: '#5f6470',
  danger: '#a05a5a',
  chipIdleBg: '#edebe0',
  disabledSend: '#c9c6ba',
  chevron: '#c1beb2',
  // "Needs a yes" invite card
  inviteBg: '#f6efdc',
  inviteBorder: '#eadfc0',
  inviteAccent: '#8a5f38',
  inviteBtnBorder: '#d9cda8',
  inviteBtnText: '#7a6c35',
  // Open invite card
  openBg: '#e6eaf2',
  openBorder: '#d5dbe8',
  // Success / "you're in"
  successBg: '#dcecdf',
  successFg: '#47694f',
  successDot: '#cfe3d4',
  // Leaderboard "you" row
  youRowBg: '#eef0f7',
  dotIdle: '#eceadf',
  dotIdleFg: '#b5b1a4',
  // "Can't go" pill
  outBg: '#f0eee6',
  outFg: '#9a978c',
};

// Category palettes (event color coding)
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
