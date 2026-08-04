// Shapes for the data the app renders. In Phase 2 these get filled from the
// Instagram Graph API; for now they come from mockData.ts.

export type Trend = 'up' | 'down' | null;

export interface Metric {
  key: string;
  label: string;
  value: number;
  // Optional unit suffix, e.g. '%'
  unit?: string;
  // Change vs. previous period (for the small ▲/▼ badge)
  delta?: number;
  trend?: Trend;
  // Where this number legitimately comes from. Used for a small footnote so
  // the app stays honest about what Instagram actually exposes.
  source: 'api' | 'tracked';
}

export interface Profile {
  username: string;
  fullName: string;
  avatarUrl: string;
  followers: number;
  following: number;
}
